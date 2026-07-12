/* ============================================================
   Sprint 16 test harness — Local Backend & Real Persistence
   (FRONTEND side). Runs in the browser (no backend needed —
   API calls use injected mock transports). Snapshots ALL
   localStorage and restores it in a finally block.

   Covers PART 10 (frontend):
     1  local mode still works
     2  backend connection detection
     3  RESTStorageProvider works (mirror + async push)
     4  offline fallback (write kept locally + queued)
     5  migration does NOT remove local data
     6  existing workflows remain unchanged
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 15));

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

    ['1 · Local mode still works (default)', async () => {
      Backend.useLocal();
      assert(AppStorage.kind() === 'local', 'active provider is not local');
      assert(Backend.mode() === 'local', 'default storage mode should be local');
      AppStorage.set('m1', { v: 9 });
      assert(AppStorage.get('m1').v === 9, 'local set/get failed');
      AppStorage.remove('m1');
      assert(AppStorage.get('m1') === null, 'local remove failed');
      return 'AppStorage local get/set/remove work · mode defaults to local';
    }],

    ['2 · Backend connection detection', async () => {
      const okT = async (url) => {
        if (/\/api\/health$/.test(url)) return { ok: true, status: 200, data: { status: 'ok', api_version: '0.1.0', service: 'CareerPilot Backend', time: '' } };
        if (/\/api\/status$/.test(url)) return { ok: true, status: 200, data: { database: 'connected', environment: 'development', counts: {} } };
        return { ok: true, status: 200, data: {} };
      };
      const s1 = await Backend.testConnection({ transport: okT });
      assert(s1.reachable === true && s1.apiVersion === '0.1.0' && s1.database === 'connected', 'reachable backend not detected');
      const s2 = await Backend.testConnection({ transport: async () => { throw new Error('ECONNREFUSED'); } });
      assert(s2.reachable === false, 'offline backend not detected');
      assert(Backend.mode() === 'local', 'a failed test must not flip mode to backend');
      return 'health/status parsed when up; unreachable detected when down; mode stays local';
    }],

    ['3 · RESTStorageProvider works (mirror + push)', async () => {
      const calls = [];
      const transport = async (url, o) => { calls.push({ url, method: o.method, body: o.body }); return { ok: true, status: 200, data: { ok: true } }; };
      const p = StorageProviders.create('rest', { baseUrl: 'http://test', transport, namespace: 'test_rest_a.' });
      assert(p.configured === true && p.kind === 'rest', 'rest provider not configured');
      const r = p.set('kx', { a: 1 });
      assert(r.ok, 'set failed');
      assert(p.get('kx').a === 1, 'mirror read failed');                 // sync read from mirror
      const put = calls.find(c => c.method === 'PUT');
      assert(put && /\/api\/kv\/kx$/.test(put.url), 'no PUT pushed to /api/kv');
      assert(put.body === JSON.stringify({ value: { a: 1 } }), 'push body wrong');
      await tick();
      assert(p.healthCheck().reachable === true, 'reachable not set after successful push');
      p.remove('kx');
      assert(p.get('kx') === null, 'mirror remove failed');
      assert(calls.some(c => c.method === 'DELETE'), 'no DELETE pushed');
      p.clear();
      return 'reads sync from mirror; writes push PUT/DELETE to /api/kv; reachable tracked';
    }],

    ['4 · Offline fallback (kept locally + queued)', async () => {
      SyncManager.clear(); SyncManager.setOnline(true);
      const p = StorageProviders.create('rest', { baseUrl: 'http://test', transport: async () => { throw new Error('refused'); }, namespace: 'test_rest_b.' });
      const before = SyncManager.pending().length;
      p.set('kf', { b: 2 });
      assert(p.get('kf').b === 2, 'write not preserved locally while offline');
      await tick(25);
      assert(SyncManager.pending().length === before + 1, 'offline write was not queued for sync');
      assert(p.healthCheck().reachable === false, 'reachable should be false when backend down');
      p.clear();
      return 'write kept in local mirror + enqueued on SyncManager; nothing lost';
    }],

    ['5 · Migration does NOT remove local data', async () => {
      // seed real domain data
      const item = makeItem('mig-1');
      Prep.buildFor(item); Prep.markReady(item.job.id); SubmissionEngine.approveAndSubmit(item.job.id);
      ApplicationMemory.syncFromSubmissions();
      const cnt = Migration.counts();
      assert(cnt.packages >= 1 && cnt.submitted >= 1 && cnt.interviews >= 1, 'bundle missing seeded domain data');
      assert(cnt.profile === 1, 'bundle missing profile');

      const keys = ['careerpilot_profile_v1', 'careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1'];
      const before = {}; keys.forEach(k => before[k] = localStorage.getItem(k));

      const transport = async (url) => {
        if (/\/api\/migrate\/preview$/.test(url)) return { ok: true, status: 200, data: { entities: { jobs: 1 }, total: 5 } };
        if (/\/api\/migrate$/.test(url)) return { ok: true, status: 200, data: { migration_id: 1, status: 'completed', started_at: '', finished_at: '', success_count: 5, failed_count: 0, skipped_count: 0, counts: {}, failures: [] } };
        return { ok: true, status: 200, data: {} };
      };
      const res = await Migration.migrate({ transport });
      assert(res.success_count === 5, 'migrate result not returned');
      keys.forEach(k => assert(localStorage.getItem(k) === before[k], 'migration modified local key: ' + k));
      const last = Migration.lastMigration();
      assert(last && last.result.success_count === 5, 'migration result not recorded locally');
      return 'bundle built read-only; all 4 domain keys byte-identical after migrate; result recorded';
    }],

    ['6 · Existing workflows remain unchanged', async () => {
      const item = makeItem('s16-reg-1');
      Prep.buildFor(item);
      assert(Prep.markReady(item.job.id) === true, 'markReady broke');
      const rec = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(rec && rec.status === 'submitted', 'submission workflow broke');
      ApplicationMemory.syncFromSubmissions();
      assert(ApplicationMemory.get(item.job.id).submitted.answers.length === 13, 'interview memory broke');
      assert(Connectors.all().length === 8 && Array.isArray(ConnectorManager.collect()), 'connector framework broke');
      assert(JobSchema.REQUIRED_FIELDS.length === 16, 'job schema changed');
      assert(typeof AppStorage !== 'undefined' && AppStorage.healthCheck().ok && typeof SyncManager !== 'undefined', 'platform layer changed');
      assert(typeof ConnectorIntegration !== 'undefined', 'sprint 15 integration layer missing');
      return 'submit + interview + connectors + integration layer + platform all intact';
    }],
  ];

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.indexOf('careerpilot_platform.') === 0 || k.indexOf('test_rest_') === 0)) kill.push(k); }
      kill.concat(['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1', 'careerpilot_profile_v1', 'careerpilot_backend_cfg', 'careerpilot_migration_last']).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      for (const [name, fn] of CASES) {
        try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
    } finally {
      Backend.useLocal();   // restore local provider before wiping
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
    console.log(`Sprint 16 (frontend): ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
