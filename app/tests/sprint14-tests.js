/* ============================================================
   Sprint 14 test harness — Backend Integration Foundation.
   Runs in the browser (no Node/CLI runtime in this project).
   Open app/tests/sprint14.html to execute. Snapshots ALL
   localStorage and restores it in a finally block, so app data is
   untouched. Cases are async (the API-client tests await).

   Covers PART 10:
     1  LocalStorageProvider works (+ transaction rollback)
     2  provider interface can be swapped
     3  API client retries + times out (+ non-retryable + cancel)
     4  SyncManager queues pending work
     5  offline mode preserves operations
     6  retry queue + conflict detection work
     7  cache expiry, SWR, dedupe + invalidation work
     8  centralized errors persist
     9  hidden admin route renders
    10  existing job/resume/application/interview workflows unchanged
    11  existing local user data survives (namespaced, never cleared)
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function makeItem(id) {
    const job = JobSchema.normalized({
      id: id, source: 'Greenhouse', sourceJobId: id.toUpperCase(),
      title: 'Solutions Engineer', company: 'Acme Cloud',
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 120, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year', visaSponsorship: true,
      description: 'Own technical delivery. Terraform, Kubernetes and Azure across client onboarding.',
      skills: ['Terraform', 'Kubernetes', 'Azure', 'Python'], preferredSkills: ['SQL'],
      applyUrl: 'https://boards.example.com/' + id,
    });
    return { job, res: { score: 88, matched: ['Terraform', 'Kubernetes', 'Azure'], missing: [] },
      decision: { outcome: 'auto_approve', recommendation: 'Strong Match', confidence: 'High', reasons: [{ ok: true, text: 'ok' }] } };
  }

  const CASES = [

    ['1 · LocalStorageProvider works (+ transaction rollback)', async () => {
      AppStorage.set('t1', { a: 1 });
      assert(AppStorage.get('t1').a === 1, 'get after set failed');
      assert(AppStorage.list().indexOf('t1') !== -1, 'list missing key');
      AppStorage.remove('t1');
      assert(AppStorage.get('t1') === null, 'remove failed');
      const h = AppStorage.healthCheck();
      assert(h.ok && h.writable, 'healthCheck not writable');
      // commit
      AppStorage.set('keep', 1);
      const rc = AppStorage.transaction(s => { s.set('committed', 9); return 'done'; });
      assert(rc.ok && rc.result === 'done' && AppStorage.get('committed') === 9, 'transaction commit failed');
      // rollback
      const rb = AppStorage.transaction(s => { s.set('temp', 2); throw new Error('boom'); });
      assert(rb.ok === false, 'transaction should report failure');
      assert(AppStorage.get('temp') === null, 'rollback did not remove temp');
      assert(AppStorage.get('keep') === 1, 'rollback lost pre-existing key');
      return 'get/set/remove/list/health + transaction commit & rollback all work';
    }],

    ['2 · Provider interface can be swapped', async () => {
      const iface = ['get', 'set', 'remove', 'list', 'clear', 'transaction', 'healthCheck'];
      ['rest', 'postgres', 'supabase', 'firebase'].forEach(k => {
        assert(StorageProviders.kinds.indexOf(k) !== -1, 'missing prepared provider: ' + k);
        const p = StorageProviders.create(k);
        iface.forEach(m => assert(typeof p[m] === 'function', k + ' missing method ' + m));
        assert(p.configured === false && p.healthCheck().configured === false, k + ' should be interface-only');
      });
      // swap the ACTIVE provider and prove the same interface keeps working
      const prev = AppStorage.active();
      try {
        const alt = StorageProviders.create('local', { namespace: 'test_ns_B.' });
        AppStorage.use(alt);
        AppStorage.set('x', 7);
        assert(AppStorage.get('x') === 7 && alt.get('x') === 7, 'swapped provider did not store');
        alt.clear();
      } finally { AppStorage.use(prev); }
      return '4 remote providers implement the interface; active provider hot-swappable';
    }],

    ['3 · API client retries, times out, cancels', async () => {
      // retry then succeed
      let calls = 0;
      const flaky = async () => { calls++; if (calls < 3) throw new Error('network'); return { ok: true, status: 200, data: { n: calls } }; };
      const res = await APIClient.get('/x', { transport: flaky, retries: 2, retryBackoffMs: 0 });
      assert(res.data.n === 3 && calls === 3, 'retry path wrong (calls=' + calls + ')');
      // non-retryable 400 → single attempt, structured error
      let calls2 = 0;
      const bad = async () => { calls2++; return { ok: false, status: 400, data: { error: 'bad' } }; };
      let e400 = null;
      try { await APIClient.get('/b', { transport: bad, retries: 2, retryBackoffMs: 0 }); } catch (e) { e400 = e; }
      assert(e400 && e400.status === 400 && !e400.retryable && calls2 === 1, 'non-retryable handling wrong');
      // timeout
      let et = null;
      try { await APIClient.get('/t', { transport: () => new Promise(() => {}), timeout: 20, retries: 0 }); } catch (e) { et = e; }
      assert(et && et.category === 'timeout', 'timeout not raised');
      // cancellation
      const c = new AbortController(); c.abort();
      let ec = null;
      try { await APIClient.get('/c', { transport: async () => ({ ok: true, status: 200, data: {} }), signal: c.signal }); } catch (e) { ec = e; }
      assert(ec && ec.category === 'cancelled', 'cancellation not raised');
      return 'retry→success (3 calls) · 400 no-retry · timeout · cancel — all structured';
    }],

    ['4 · SyncManager queues pending work', async () => {
      SyncManager.clear();
      SyncManager.enqueue({ type: 'set', entity: 'profile', key: 'p', payload: { x: 1 }, baseVersion: 1, optimistic: true });
      SyncManager.enqueue({ type: 'delete', entity: 'job', key: 'j' });
      assert(SyncManager.pending().length === 2, 'expected 2 pending');
      assert(SyncManager.status().pending === 2, 'status pending wrong');
      return '2 operations queued with timestamps + optimistic flag';
    }],

    ['5 · Offline mode preserves operations', async () => {
      SyncManager.clear();
      SyncManager.setOnline(false);
      SyncManager.enqueue({ type: 'set', entity: 'a', key: '1' });
      SyncManager.enqueue({ type: 'set', entity: 'b', key: '2' });
      const r = await SyncManager.flush();
      assert(r.skipped === true && r.online === false, 'flush should skip while offline');
      assert(SyncManager.pending().length === 2, 'offline flush lost operations');
      return 'offline flush is a no-op; queued operations preserved';
    }],

    ['6 · Retry queue + conflict detection', async () => {
      SyncManager.clear();
      SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'a', key: '1', baseVersion: 1 });
      SyncManager.enqueue({ type: 'set', entity: 'b', key: '2', baseVersion: 1 });
      const fail = async () => ({ ok: false, error: 'server 500' });
      const r1 = await SyncManager.flush(fail);
      assert(r1.failed === 2 && SyncManager.failedOps().length === 2, 'failed ops not parked');
      assert(SyncManager.retry() === 2, 'retry did not re-arm ops');
      const ok = async (op) => ({ ok: true, serverVersion: (op.baseVersion || 0) + 1 });
      const r2 = await SyncManager.flush(ok);
      assert(r2.synced === 2 && SyncManager.pending().length === 0 && SyncManager.lastSync(), 'retry flush did not drain queue');
      // conflict
      SyncManager.clear(); SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'e', key: 'k', baseVersion: 1 });
      const rc = await SyncManager.flush(async () => ({ ok: false, conflict: true, serverVersion: 2 }));
      assert(rc.conflicts === 1 && SyncManager.pending().some(o => o.conflict), 'conflict not detected');
      return 'failed→retry→synced; version conflict detected + parked';
    }],

    ['7 · Cache expiry, SWR, dedupe + invalidation', async () => {
      JobCache.clear();
      JobCache.set('q1', [{ id: 'a' }, { id: 'a' }, { id: 'b' }], { ttlMs: 60000, source: 'linkedin' });
      const g = JobCache.get('q1');
      assert(g.hit && !g.stale && g.data.length === 2, 'dedupe/fresh get failed');
      JobCache.set('q2', [{ id: 'x' }], { ttlMs: -1000, source: 'bayt' });
      const s = JobCache.get('q2');
      assert(s.hit && s.stale, 'stale-while-revalidate did not return stale data');
      assert(JobCache.invalidate('q1') === true && !JobCache.get('q1').hit, 'invalidate(key) failed');
      assert(JobCache.invalidateSource('bayt') >= 1 && !JobCache.get('q2').hit, 'invalidateSource failed');
      return 'dedupe (3→2) · fresh vs stale (SWR) · invalidate by key + source';
    }],

    ['8 · Centralized errors persist', async () => {
      const e = ErrorCenter.record({ category: 'validation', message: 'bad input', source: 'test', severity: 'warning', retryable: false, technical: { field: 'x' } });
      assert(e.id && e.timestamp, 'record returned no entry');
      assert(ErrorCenter.recent(20).some(x => x.id === e.id), 'not in recent');
      const raw = AppStorage.get('errors');
      assert(Array.isArray(raw) && raw.some(x => x.id === e.id), 'not persisted to storage');
      assert(ErrorCenter.counts().validation >= 1, 'category count wrong');
      return 'error recorded, categorized, persisted to storage + reloadable';
    }],

    ['9 · Hidden admin route renders', async () => {
      const html = AdminView.render();
      assert(typeof html === 'string' && html.length > 300, 'admin render empty');
      ['Storage provider', 'Session', 'Sync manager', 'Job cache', 'API client', 'Centralized errors', '#/admin']
        .forEach(m => assert(html.indexOf(m) !== -1, 'admin missing section: ' + m));
      return 'admin diagnostics renders all platform panels';
    }],

    ['10 · Existing workflows remain unchanged', async () => {
      const item = makeItem('plat-reg-1');
      Prep.buildFor(item);
      assert(Prep.markReady(item.job.id) === true, 'markReady failed');
      const rec = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(rec && rec.status === 'submitted', 'submission workflow broke');
      ApplicationMemory.syncFromSubmissions();
      const mem = ApplicationMemory.get(item.job.id);
      assert(mem && mem.submitted.answers.length === 13, 'interview memory workflow broke');
      assert(ApplicationsStore.load().length > 0, 'application board broke');
      assert(Connectors.all().length === 8 && Array.isArray(ConnectorManager.collect()), 'connector framework broke');
      assert(typeof ResumesStore !== 'undefined' && typeof JobsStore !== 'undefined', 'resume/jobs modules missing');
      return 'job→prep→submit→interview + board + connectors all intact';
    }],

    ['11 · Existing local user data survives (never cleared)', async () => {
      localStorage.setItem('careerpilot_profile_v1', JSON.stringify({ sentinel: 'KEEP-ME' }));
      const before = localStorage.getItem('careerpilot_profile_v1');
      // exercise the whole platform layer, then clear the platform namespace
      AppStorage.set('probe', { a: 1 });
      SessionManager.init();
      ErrorCenter.record({ category: 'storage', message: 'x' });
      AppStorage.clear();   // namespace-scoped
      const after = localStorage.getItem('careerpilot_profile_v1');
      assert(before === after, 'existing user data was modified by the platform layer');
      assert(AppStorage.get('probe') === null, 'namespace clear did not remove platform keys');
      return 'existing key untouched by platform writes + namespace-scoped clear';
    }],
  ];

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      // clean slate: platform namespace + the app keys the regression test touches
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('careerpilot_platform.') === 0) kill.push(k); }
      kill.concat(['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1', 'careerpilot_profile_v1']).forEach(k => localStorage.removeItem(k));
      for (const [name, fn] of CASES) {
        try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
    } finally {
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
    }
    return results;
  }

  function render(results) {
    const passed = results.filter(r => r.pass).length;
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    document.getElementById('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${r.name}</b><div class="detail">${r.detail}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 14: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
