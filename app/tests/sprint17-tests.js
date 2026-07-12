/* ============================================================
   Sprint 17 test harness — Live Backend Sync & Two-Way Persistence
   (FRONTEND). Runs in the browser with INJECTED MOCK TRANSPORTS —
   no running backend is required. Snapshots ALL localStorage and
   restores it in a finally block.

   PART 7 coverage:
     1  local mode remains unchanged
     2  backend hydration fills an empty mirror
     3  hydration does NOT overwrite a newer unsynced local write
     4  offline write is queued
     5  successful flush removes ONLY confirmed operations
     6  failed flush keeps operations queued
     7  concurrent flush prevention
     8  backend 409 becomes a recorded conflict
     9  immutable submitted provenance is not overwritten
    10  existing search/approval/submit/interview workflows intact
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const OK = { ok: true, status: 200, data: { ok: true } };

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

    ['1 · Local mode remains unchanged', async () => {
      Backend.useLocal();
      assert(AppStorage.kind() === 'local', 'active provider is not local');
      assert(Backend.mode() === 'local', 'default storage mode must be local');
      AppStorage.set('m1', { v: 9 });
      assert(AppStorage.get('m1').v === 9, 'local set/get failed');
      AppStorage.remove('m1');
      assert(AppStorage.get('m1') === null, 'local remove failed');
      return 'local provider active by default; get/set/remove work';
    }],

    ['2 · Backend hydration fills an empty mirror', async () => {
      const t = async (url) => {
        if (/\/api\/kv\?prefix=/.test(url)) return { ok: true, status: 200, data: { keys: ['t17a.k1'], entries: [{ key: 't17a.k1', updated_at: '2026-01-01T00:00:00Z' }], count: 1 } };
        if (/\/api\/kv\/t17a\.k1$/.test(url)) return { ok: true, status: 200, data: { key: 't17a.k1', value: { n: 1 }, updated_at: '2026-01-01T00:00:00Z' } };
        return OK;
      };
      const p = StorageProviders.create('rest', { baseUrl: 'http://test', transport: t, namespace: 't17a.' });
      assert(p.get('k1') === null, 'mirror should start empty');
      const r = await p.hydrate({ transport: t });
      assert(r.ok, 'hydration failed: ' + r.error);
      assert(r.applied === 1 && r.added === 1, 'expected 1 applied/added, got ' + r.applied + '/' + r.added);
      assert(p.get('k1').n === 1, 'backend value not merged into the mirror');
      const d = await p.diff({ transport: t });
      assert(d.both.indexOf('k1') !== -1, 'diff should report the key on both sides');
      p.clear();
      return 'empty mirror hydrated from /api/kv (1 key applied) · diff reports both sides';
    }],

    ['3 · Hydration does NOT overwrite a newer unsynced local write', async () => {
      ConflictCenter.clear(); SyncManager.clear();
      const t = async (url, o) => {
        if (o.method === 'PUT') throw new Error('backend down');            // local write stays UNSYNCED
        if (/\/api\/kv\?prefix=/.test(url)) return { ok: true, status: 200, data: { entries: [{ key: 't17b.k1', updated_at: '2020-01-01T00:00:00Z' }] } };
        if (/\/api\/kv\/t17b\.k1$/.test(url)) return { ok: true, status: 200, data: { key: 't17b.k1', value: { backend: true }, updated_at: '2020-01-01T00:00:00Z' } };
        return OK;
      };
      const p = StorageProviders.create('rest', { baseUrl: 'http://test', transport: t, namespace: 't17b.' });
      p.set('k1', { local: true });                                          // newer, unsynced
      await tick(25);
      const r = await p.hydrate({ transport: t });
      assert(r.ok, 'hydration errored');
      assert(r.skipped >= 1, 'the newer local write should have been skipped');
      assert(p.get('k1').local === true, 'LOCAL WRITE WAS OVERWRITTEN — data loss');
      assert(ConflictCenter.forEntity('kv').length >= 1, 'no conflict recorded for the kept local write');
      p.clear();
      return 'older backend copy skipped; local unsynced value preserved; conflict recorded';
    }],

    ['4 · Offline write is queued', async () => {
      SyncManager.clear(); SyncManager.setOnline(true);
      const p = StorageProviders.create('rest', { baseUrl: 'http://test', transport: async () => { throw new Error('refused'); }, namespace: 't17c.' });
      const before = SyncManager.pending().length;
      p.set('kf', { b: 2 });
      assert(p.get('kf').b === 2, 'write not preserved locally while offline');
      await tick(30);
      const q = SyncManager.pending();
      assert(q.length === before + 1, 'offline write was not queued');
      assert(q[q.length - 1].entity === 'kv' && q[q.length - 1].key === 'kf', 'queued op has the wrong shape');
      p.clear();
      return 'write kept in the mirror and queued as a kv op; nothing lost';
    }],

    ['5 · Successful flush removes ONLY confirmed operations', async () => {
      SyncManager.clear(); SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'a', payload: { v: 1 } });
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'b', payload: { v: 2 } });
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'c', payload: { v: 3 } });
      const t = async (url) => { if (/\/api\/kv\/b$/.test(url)) throw new Error('network down'); return OK; };
      const r = await SyncManager.flush(SyncManager.backendTransport({ transport: t }));
      assert(r.synced === 2, 'expected 2 confirmed, got ' + r.synced);
      const left = SyncManager.pending();
      assert(left.length === 1 && left[0].key === 'b', 'only the UNCONFIRMED op should remain');
      assert(SyncManager.status().lastSuccessAt, 'lastSuccessAt not tracked');
      return '2 confirmed ops removed (FIFO); the 1 unconfirmed op stayed queued';
    }],

    ['6 · Failed flush keeps operations queued', async () => {
      SyncManager.clear(); SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'x', payload: { v: 1 } });
      SyncManager.enqueue({ type: 'delete', entity: 'kv', key: 'y' });
      const r = await SyncManager.flush(SyncManager.backendTransport({ transport: async () => { throw new Error('down'); } }));
      assert(r.synced === 0 && r.failed === 2, 'expected 0 synced / 2 failed');
      assert(SyncManager.pending().length === 2, 'failed ops must stay queued');
      assert(SyncManager.status().lastFailureAt, 'lastFailureAt not tracked');
      assert(SyncManager.pending()[0].retryCount === 1, 'retryCount not tracked');
      return 'nothing removed; both ops still queued with retryCount + lastFailureAt';
    }],

    ['7 · Concurrent flush prevention', async () => {
      SyncManager.clear(); SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'slow', payload: { v: 1 } });
      const slow = async () => { await tick(30); return OK; };
      const bt = SyncManager.backendTransport({ transport: slow });
      const p1 = SyncManager.flush(bt);                 // in flight
      const r2 = await SyncManager.flush(bt);           // must be rejected
      assert(r2.skipped === true && r2.reason === 'in_progress', 'concurrent flush was not prevented');
      const r1 = await p1;
      assert(r1.synced === 1, 'first flush should have completed');
      assert(SyncManager.isFlushing() === false, 'flush lock not released');
      return 'second concurrent flush skipped (in_progress); first completed; lock released';
    }],

    ['8 · Backend 409 becomes a recorded conflict', async () => {
      ConflictCenter.clear(); SyncManager.clear(); SyncManager.setOnline(true);
      SyncManager.enqueue({ type: 'set', entity: 'kv', key: 'dup', payload: { v: 1 } });
      const t = async () => ({ ok: false, status: 409, data: { error: { code: 'conflict' } } });
      const r = await SyncManager.flush(SyncManager.backendTransport({ transport: t }));
      assert(r.conflicts === 1, 'conflict not detected');
      assert(ConflictCenter.count() >= 1, 'conflict not recorded on ConflictCenter');
      assert(ConflictCenter.recent(1)[0].kind === 'http_409', 'conflict kind should be http_409');
      const op = SyncManager.pending().find(o => o.key === 'dup');
      assert(op && op.conflict === true && op.permanent === true, 'conflicted op must stay queued + permanent');
      assert(op.payload.v === 1, 'the LOCAL payload must never be discarded');
      // a permanent conflict is NOT retried automatically
      const r2 = await SyncManager.flush(SyncManager.backendTransport({ transport: t }));
      assert(r2.skippedPermanent === 1 && r2.conflicts === 0, 'permanent conflict was retried automatically');
      return '409 → conflict recorded, local payload kept, op permanent + not auto-retried';
    }],

    ['9 · Immutable submitted provenance is not overwritten', async () => {
      ConflictCenter.clear();
      const item = makeItem('s17-prov-1');
      Prep.buildFor(item); Prep.markReady(item.job.id); SubmissionEngine.approveAndSubmit(item.job.id);
      ApplicationMemory.syncFromSubmissions();
      const before = JSON.stringify(SubmissionStore.get(item.job.id).snapshot);

      const calls = [];
      const t = async (url, o) => {
        calls.push({ url, method: o.method });
        if (/\/api\/applications\/submitted$/.test(url) && o.method === 'POST') {
          return { ok: false, status: 409, data: { error: { code: 'provenance_locked' } } };
        }
        if (/\/api\/applications\/submitted\//.test(url) && o.method === 'GET') {
          return { ok: true, status: 200, data: { job_key: item.job.id, snapshot: { resume: { safety: 0 } } } };  // DIFFERENT
        }
        return OK;
      };
      const res = await DomainSync.pushAll({ transport: t });
      assert(res.ok, 'pushAll failed');
      const prov = ConflictCenter.forEntity('submitted');
      assert(prov.length >= 1 && prov[0].kind === 'provenance', 'no provenance conflict recorded');
      assert(prov[0].local && prov[0].backend, 'both sides must be retained in the conflict');
      // the backend record was NEVER overwritten
      const overwrite = calls.filter(c => /\/api\/applications\/submitted/.test(c.url) && (c.method === 'PUT' || c.method === 'PATCH'));
      assert(overwrite.length === 0, 'submitted provenance was overwritten on the backend');
      // the local snapshot is untouched
      assert(JSON.stringify(SubmissionStore.get(item.job.id).snapshot) === before, 'local submitted snapshot was mutated');
      return '409 → provenance conflict recorded (both versions kept); no PUT/PATCH to submitted; local snapshot intact';
    }],

    ['10 · Existing workflows remain intact', async () => {
      const item = makeItem('s17-reg-1');
      Prep.buildFor(item);
      assert(Prep.markReady(item.job.id) === true, 'markReady broke');
      const rec = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(rec && rec.status === 'submitted', 'submission workflow broke');
      ApplicationMemory.syncFromSubmissions();
      assert(ApplicationMemory.get(item.job.id).submitted.answers.length === 13, 'interview memory broke');
      assert(Connectors.all().length === 8 && Array.isArray(ConnectorManager.collect()), 'connector framework broke');
      assert(typeof ConnectorIntegration !== 'undefined', 'sprint 15 integration layer missing');
      assert(JobSchema.REQUIRED_FIELDS.length === 16, 'job schema changed');
      assert(AppStorage.healthCheck().ok, 'platform storage broke');
      return 'search/approval/submit/interview + connectors + platform all intact';
    }],
  ];

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf('careerpilot_platform.') === 0 || k.indexOf('t17') === 0)) kill.push(k);
      }
      kill.concat(['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1',
        'careerpilot_profile_v1', 'careerpilot_backend_cfg', 'careerpilot_migration_last'])
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });

      for (const [name, fn] of CASES) {
        try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
    } finally {
      try { Backend.useLocal(); } catch (e) { /* ignore */ }
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
    console.log(`Sprint 17 (frontend): ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
