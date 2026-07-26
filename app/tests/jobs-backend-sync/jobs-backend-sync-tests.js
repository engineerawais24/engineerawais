/* ============================================================
   Extension "Save Current Job" → Today's Jobs — browser harness.

   Real JobsBackendSync + ImportedJobs + AppStorage + APIClient (with a stubbed
   transport standing in for the backend). localStorage is snapshotted and
   restored so no real data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* ---- stub the backend transport ---- */
  let backendJobs = [];
  let reachable = true;
  function fake(url, opts) {
    if (/\/api\/jobs/.test(url)) {
      if (!reachable) return Promise.resolve({ ok: false, status: 503, data: null });
      return Promise.resolve({ ok: true, status: 200, data: backendJobs });
    }
    return Promise.resolve({ ok: true, status: 200, data: {} });
  }
  APIClient.configure({ transport: fake });

  /* a backend JobOut as the extension's Save Current Job would leave it */
  function backendJob(over) {
    return Object.assign({
      id: 101, ext_id: 'ext-9f3a1c2b', source: 'Company Careers', source_job_id: 'ext-9f3a1c2b',
      title: 'Senior Engineer', company: 'Acme', location: 'Dubai', work_mode: 'Remote',
      employment_type: 'Full-time', salary: '', salary_disclosed: false, currency: 'USD',
      description: '', skills: [], apply_url: 'https://acme.com/jobs/123', canonical_url: 'https://acme.com/jobs/123',
      posted_date: '2026-07-25', created_at: '2026-07-25T00:00:00',
    }, over || {});
  }
  const urlsIn = () => ImportedJobs.active().map(j => j.url);
  const countUrl = u => ImportedJobs.active().filter(j => j.url === u).length;

  const CASES = [

    ['1 · A job saved from the extension appears in Today\'s Jobs', async () => {
      ImportedJobs.clear();
      backendJobs = [backendJob()];
      const r = await JobsBackendSync.pull({ force: true });
      assert(r.ok && r.added === 1, 'pull should add the saved job: ' + JSON.stringify(r));
      const j = ImportedJobs.active().find(x => x.url === 'https://acme.com/jobs/123');
      assert(j, 'saved job must be visible in Today\'s Jobs (ImportedJobs.active drives the Imports panel)');
      assert(j.title === 'Senior Engineer' && j.company === 'Acme' && j.source === 'Company Careers', 'fields mapped from JobOut');
      assert(j.workplaceType === 'Remote' && j.origin === 'backend', 'work mode mapped · provenance marked');
      return 'backend job → visible in Today\'s Jobs';
    }],

    ['2 · Re-pulling never creates a duplicate', async () => {
      ImportedJobs.clear();
      backendJobs = [backendJob()];
      await JobsBackendSync.pull({ force: true });
      const r = await JobsBackendSync.pull({ force: true });
      assert(r.added === 0 && r.duplicate === 1, 'second pull must dedupe, not add: ' + JSON.stringify(r));
      assert(countUrl('https://acme.com/jobs/123') === 1, 'exactly one copy of the job');
      return 'idempotent pull · one copy';
    }],

    ['3 · Existing local jobs are preserved', async () => {
      ImportedJobs.clear();
      const local = ImportedJobs.create({ title: 'Local Role', company: 'LocalCo', url: 'https://localco.com/jobs/9', description: 'A local posting.' });
      assert(local.ok, 'local import should be created');
      backendJobs = [backendJob()];                       // a DIFFERENT url
      const r = await JobsBackendSync.pull({ force: true });
      assert(r.added === 1, 'the backend job should be added');
      assert(urlsIn().indexOf('https://localco.com/jobs/9') !== -1, 'the pre-existing local job must survive');
      assert(urlsIn().indexOf('https://acme.com/jobs/123') !== -1, 'the backend job is present too');
      assert(ImportedJobs.active().length === 2, 'both jobs present — nothing lost');
      return 'local + backend both present';
    }],

    ['4 · A backend job that already exists locally is not duplicated', async () => {
      ImportedJobs.clear();
      ImportedJobs.create({ title: 'My Save', company: 'Acme', url: 'https://acme.com/jobs/123', description: 'Saved earlier.' });
      backendJobs = [backendJob({ apply_url: 'https://acme.com/jobs/123', canonical_url: 'https://acme.com/jobs/123' })];
      const r = await JobsBackendSync.pull({ force: true });
      assert(r.added === 0 && r.duplicate === 1, 'a URL already local must not be re-added: ' + JSON.stringify(r));
      assert(countUrl('https://acme.com/jobs/123') === 1, 'still exactly one');
      return 'canonical-URL dedupe against local jobs';
    }],

    ['5 · upsertFromBackend maps fields, salary, workplace & falls back the description', () => {
      ImportedJobs.clear();
      const r = ImportedJobs.upsertFromBackend(backendJob({
        apply_url: 'https://x.com/1', canonical_url: 'https://x.com/1',
        work_mode: 'Hybrid', salary_disclosed: true, salary: '120000', currency: 'USD', description: '',
      }));
      assert(r.ok && r.job, 'should create');
      assert(r.job.workplaceType === 'Hybrid', 'work_mode → Hybrid');
      assert(r.job.salaryDisclosed === true && r.job.salary === 120000 && r.job.currency === 'USD' && r.job.salaryPeriod === 'year', 'salary mapped');
      assert(/^Saved from/.test(r.job.description), 'empty description falls back to a note');
      assert(!ImportedJobs.upsertFromBackend(backendJob({ apply_url: 'https://y.com/2', canonical_url: 'https://y.com/2', title: '' })).ok, 'no title → rejected');
      assert(!ImportedJobs.upsertFromBackend(backendJob({ apply_url: '', canonical_url: '' })).ok, 'no url → rejected');
      return 'field/salary/workplace mapping + guards';
    }],

    ['6 · Backend unreachable → nothing added, no error', async () => {
      ImportedJobs.clear();
      reachable = false;
      backendJobs = [backendJob()];
      const r = await JobsBackendSync.pull({ force: true });
      reachable = true;
      assert(r.skipped && r.reason === 'backend unreachable', 'unreachable should skip cleanly: ' + JSON.stringify(r));
      assert(ImportedJobs.active().length === 0, 'nothing added when the backend is down');
      return 'unreachable → clean no-op';
    }],

    ['7 · Pull is throttled to avoid spamming on navigation', async () => {
      ImportedJobs.clear();
      backendJobs = [backendJob()];
      await JobsBackendSync.pull({ force: true });    // sets the throttle clock
      const r = await JobsBackendSync.pull();         // immediate, unforced
      assert(r.skipped && r.reason === 'throttled', 'a rapid second pull should be throttled: ' + JSON.stringify(r));
      return 'throttled within the min interval';
    }],

    ['8 · Distinct backend jobs that share a canonical URL are NOT merged', async () => {
      ImportedJobs.clear();
      /* Oracle/SPA ATS: distinguishing requisition id in the query → both URLs
         canonicalize to the same base. They must remain two separate jobs. */
      const base = 'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/candidateApplication?requisitionId=';
      backendJobs = [
        backendJob({ id: 700, source_job_id: 'ext-ms', title: 'Technical Consultant', company: 'Microsoft', apply_url: base + '1000', canonical_url: base + '1000' }),
        backendJob({ id: 701, source_job_id: 'ext-wsp', title: 'WSP — Work Summary', company: 'WSP', apply_url: base + '2000', canonical_url: base + '2000' }),
      ];
      const r = await JobsBackendSync.pull({ force: true });
      assert(r.added === 2 && r.duplicate === 0, 'both distinct jobs must be added, not merged: ' + JSON.stringify(r));
      const companies = ImportedJobs.active().map(j => j.company).sort();
      assert(companies.join(',') === 'Microsoft,WSP', 'both companies present & distinct: ' + companies.join(','));
      /* re-pulling the same two is idempotent (dedup by backend identity) */
      const again = await JobsBackendSync.pull({ force: true });
      assert(again.added === 0 && again.duplicate === 2, 're-pull must dedupe by backend identity: ' + JSON.stringify(again));
      return 'shared canonical URL → two separate imports · idempotent re-pull';
    }],
  ];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function run() {
    const results = [];
    for (const [name, fn] of CASES) {
      try { results.push({ name, pass: true, detail: (await fn()) || '' }); }
      catch (e) { results.push({ name, pass: false, detail: e.message }); }
    }
    return results;
  }

  async function guardedRun() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    let results;
    try { localStorage.clear(); results = await run(); }
    finally { localStorage.clear(); Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k])); }
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
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Jobs backend sync: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await guardedRun()));
})();
