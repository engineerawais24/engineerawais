/* ============================================================
   "Clear all job data" — browser harness for JobDataReset.

   Real stores, real AppStorage, real reset. localStorage is snapshotted and
   restored in a finally block, so the developer's own data is never at risk.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  const LI = 'https://www.linkedin.com/jobs/search/?keywords=network%20security';
  const BAYT = 'https://www.bayt.com/en/uae/jobs/network-security-jobs/';

  /* ---------- seeding ---------- */

  /* put something in EVERY job store the reset claims to clear */
  function seedJobData() {
    JobsStore.save({ decisions: { j1: 'approved', j2: 'rejected' }, discovered: [{ id: 'j1', title: 'X', company: 'Y' }] });
    ImportedJobs.upsertFromBackend({
      id: 1, source: 'LinkedIn', source_job_id: 'linkedin-1', title: 'Network Security Engineer',
      company: 'Elm', apply_url: 'https://www.linkedin.com/jobs/view/1/', canonical_url: 'https://www.linkedin.com/jobs/view/1/',
    });
    AppStorage.set(ApplicationPackages.STORAGE_KEY, [{ id: 'pkg-1', jobId: 'j1', status: 'ready_to_apply' }]);
    AppStorage.set(ApplicationQueue.KEY, { active: true, order: ['j1'], outcomes: { j1: 'applied' }, current: 'j1' });
    localStorage.setItem(ApplicationsStore.KEY, JSON.stringify([{ company: 'Acme', position: 'SE', status: 'Applied' }]));
    localStorage.setItem(PrepStore.KEY, JSON.stringify({ j1: { built: true } }));
    localStorage.setItem(SubmissionStore.KEY, JSON.stringify([{ jobKey: 'j1', status: 'submitted' }]));
    localStorage.setItem(ApplicationMemory.KEY, JSON.stringify([{ jobKey: 'j1', company: 'Acme' }]));
    localStorage.setItem(Activity.KEY, JSON.stringify([{ msg: 'Approved Acme', t: Date.now() }]));
    AppStorage.set(CoverLetter.STORAGE_KEY, { j1: { body: 'Dear...' } });
    AppStorage.set(ResumeRecommender.STORAGE_KEY, { j1: 'res-2' });
    AppStorage.set(JobCache.STORAGE_KEY, { some: 'cached job' });
    AppStorage.set(SearchCache.STORAGE_KEY, { some: 'cached search' });
    localStorage.setItem(SyncLog.KEY, JSON.stringify([{ at: 1, what: 'sync' }]));
    DB.approvals = [{ id: 'a1', company: 'Acme', status: 'awaiting' }];
    DB.applications = [{ company: 'Acme', status: 'Applied' }];
    /* discovery: saved URLs (KEEP) + last run counts (CLEAR) */
    JobFetchStore.setSearch('LinkedIn', LI);
    JobFetchStore.setSearch('Bayt', BAYT);
    JobFetchStore.saveRun({ ok: true, totals: { found: 9, saved: 9, duplicate: 0, failed: 0 }, sources: [] });
  }

  /* the personal data that must come through untouched */
  const PROFILE = {
    personal: { firstName: 'Mohammad', lastName: 'Awais', headline: 'Network Security Engineer' },
    contact: { email: 'engineer.awais24@example.com', phone: '+966536886174', city: 'Riyadh', country: 'Saudi Arabia' },
    skills: ['Firewalls', 'Zero Trust'],
    certifications: [{ name: 'CISSP', issuer: 'ISC2', year: '2024' }],
    history: [{ company: 'PwC', title: 'Consultant', startDate: '2021-03' }],
    preferences: { minSalary: 110, relocation: true },
  };

  function seedPersonal() {
    localStorage.setItem('careerpilot_profile_v1', JSON.stringify(PROFILE));
    localStorage.setItem('careerpilot_documents_v1', JSON.stringify([{ id: 'doc1', name: 'Awais CV.pdf' }]));
    localStorage.setItem('careerpilot_master_resume_v1', JSON.stringify({ name: 'Awais CV.pdf', size: 12345 }));
    localStorage.setItem('careerpilot_backend_cfg', JSON.stringify({ mode: 'backend', baseUrl: 'http://127.0.0.1:8000' }));
    localStorage.setItem('careerpilot_ui_v1', JSON.stringify({ theme: 'dark' }));
    AppStorage.set('parsed_resume', { ok: true, name: 'Awais CV.pdf' });
    AppStorage.set('pre_import_backup', { taken: 'before an import' });
    AppStorage.set('profile_pre_sync_backup', [{ taken: 'before a sync' }]);
    AppStorage.set('saved_searches', [{ id: 's1', name: 'Riyadh remote' }]);
  }

  function personalSnapshot() {
    return {
      profile: localStorage.getItem('careerpilot_profile_v1'),
      documents: localStorage.getItem('careerpilot_documents_v1'),
      master: localStorage.getItem('careerpilot_master_resume_v1'),
      backendCfg: localStorage.getItem('careerpilot_backend_cfg'),
      ui: localStorage.getItem('careerpilot_ui_v1'),
      parsed: JSON.stringify(AppStorage.get('parsed_resume')),
      preImport: JSON.stringify(AppStorage.get('pre_import_backup')),
      preSync: JSON.stringify(AppStorage.get('profile_pre_sync_backup')),
      savedSearches: JSON.stringify(AppStorage.get('saved_searches')),
    };
  }

  function reset() {
    localStorage.clear();
    DB.approvals = []; DB.applications = []; DB.jobs = [];
  }

  const CASES = [

    ['1 - Every job store is emptied by one call', () => {
      reset();
      seedJobData();
      /* prove the seed actually landed */
      assert(JobsStore.load().discovered, 'seed: discovered jobs');
      assert(ImportedJobs.all().length === 1, 'seed: imported jobs');
      assert(AppStorage.get(ApplicationQueue.KEY), 'seed: queue');
      assert(localStorage.getItem(SubmissionStore.KEY), 'seed: applied history');

      const report = JobDataReset.run();
      assert(report.ok, 'the reset should report ok');

      assert(!JobsStore.load().discovered, "Today's Jobs discovered list must be gone");
      assert(Object.keys(JobsStore.load().decisions).length === 0, 'board decisions must be gone');
      assert(ImportedJobs.all().length === 0, 'imported jobs must be gone');
      assert(!AppStorage.get(ApplicationPackages.STORAGE_KEY), 'packages must be gone');
      assert(!AppStorage.get(ApplicationQueue.KEY), 'the queue must be gone');
      assert(!localStorage.getItem(ApplicationsStore.KEY), 'the applications board must be gone');
      assert(!localStorage.getItem(PrepStore.KEY), 'prepared packages must be gone');
      assert(!localStorage.getItem(SubmissionStore.KEY), 'applied history must be gone');
      assert(!localStorage.getItem(ApplicationMemory.KEY), 'application memory must be gone');
      assert(!localStorage.getItem(Activity.KEY), 'job activity must be gone');
      assert(!AppStorage.get(CoverLetter.STORAGE_KEY), 'cover letters must be gone');
      assert(!AppStorage.get(ResumeRecommender.STORAGE_KEY), 'resume overrides must be gone');
      assert(!AppStorage.get(JobCache.STORAGE_KEY), 'job cache must be gone');
      assert(!AppStorage.get(SearchCache.STORAGE_KEY), 'search cache must be gone');
      assert(!localStorage.getItem(SyncLog.KEY), 'sync log must be gone');
      assert(DB.approvals.length === 0 && DB.applications.length === 0, 'in-memory approvals/applications must be emptied');
      return report.cleared + ' store(s) cleared in one call';
    }],

    ['2 - Personal data survives byte-for-byte', () => {
      reset();
      seedPersonal();
      seedJobData();
      const before = personalSnapshot();

      JobDataReset.run();

      const after = personalSnapshot();
      Object.keys(before).forEach(k => {
        assert(before[k] === after[k], k + ' was modified by the reset:\n  before ' + before[k] + '\n  after  ' + after[k]);
      });
      /* and the profile is still readable through its own module */
      const p = JSON.parse(localStorage.getItem('careerpilot_profile_v1'));
      assert(p.personal.firstName === 'Mohammad', 'the profile must still be intact');
      assert(p.certifications.length === 1 && p.history.length === 1, 'certifications and employment survive');
      assert(p.preferences.minSalary === 110, 'preferences survive');
      return 'profile, resumes, parsed resume, backups and settings all untouched';
    }],

    ['3 - Saved search URLs survive; only the run counts are cleared', () => {
      reset();
      seedJobData();
      assert(JobFetchStore.lastRun(), 'seed: a last run exists');

      JobDataReset.run();

      assert(JobFetchStore.searchFor('LinkedIn') === LI, 'the LinkedIn saved search URL must survive');
      assert(JobFetchStore.searchFor('Bayt') === BAYT, 'the Bayt saved search URL must survive');
      assert(!JobFetchStore.lastRun(), 'the last run counts must be cleared');

      const row = JobDataReset.run().results.find(r => r.module === 'JobFetchStore');
      assert(row && row.keptSearchUrls === 2, 'the report names how many URLs were kept: ' + JSON.stringify(row));
      return '2 saved search URLs kept, run counts cleared';
    }],

    ['4 - Keys are read from the modules, never copied into the reset', () => {
      /* the guarantee that keeps this from rotting: rename a key on its module
         and the reset must follow it */
      const original = ImportedJobs.STORAGE_KEY;
      assert(JobDataReset.keyOf(ImportedJobs) === original, 'the key comes from the module');
      assert(JobDataReset.keyOf({ KEY: 'zz' }) === 'zz' && JobDataReset.keyOf({ STORAGE_KEY: 'yy' }) === 'yy',
        'both KEY and STORAGE_KEY are understood');
      assert(JobDataReset.keyOf(null) === null, 'a missing module yields no key');

      /* no target hard-codes a literal key */
      const ts = JobDataReset.targets();
      ts.forEach(t => {
        assert(!t.key, t.module + ' must not carry a hard-coded key');
        assert(typeof t.module === 'string' && t.module.length, 'every target names its module');
      });

      /* EVERY named module must actually resolve. This is the assertion that
         caught two real bugs: interview-store.js exports ApplicationMemory (not
         InterviewStore), and these modules are lexical `const` globals that are
         NOT reachable as window[name] — so a name-string lookup silently
         cleared nothing at all. */
      const missing = ts.filter(t => !t.mod).map(t => t.module);
      assert(missing.length === 0, 'every target module must resolve, missing: ' + missing.join(', '));
      assert(ts.every(t => JobDataReset.keyOf(t.mod)), 'every resolved module must yield a key');

      /* a module that is not loaded is REPORTED, not silently skipped */
      const r = JobDataReset.run();
      assert(Array.isArray(r.absent) && r.absent.length === 0, 'no module may be absent here: ' + JSON.stringify(r.absent));
      assert(r.results.length === ts.length + 1, 'every target plus the discovery counts is reported: ' + r.results.length);
      assert(r.results.every(x => x.status !== 'absent'), 'nothing was silently skipped');
      return ts.length + ' modules resolved live, keys read from each, none hard-coded';
    }],

    ['5 - The automatic run happens exactly once', () => {
      reset();
      seedJobData();
      assert(JobDataReset.hasRun() === false, 'a fresh install has not run the reset');

      const first = JobDataReset.runOnce();
      assert(!first.skipped && first.ok, 'the first load runs it: ' + JSON.stringify(first));
      assert(JobDataReset.hasRun() === true, 'the flag is set afterwards');
      assert(ImportedJobs.all().length === 0, 'and it really cleared');

      /* a second load must NOT wipe anything the user has since added */
      ImportedJobs.upsertFromBackend({
        id: 2, source: 'LinkedIn', source_job_id: 'linkedin-2', title: 'Kept Job', company: 'Keep',
        apply_url: 'https://www.linkedin.com/jobs/view/2/', canonical_url: 'https://www.linkedin.com/jobs/view/2/',
      });
      const second = JobDataReset.runOnce();
      assert(second.skipped, 'the second load must skip: ' + JSON.stringify(second));
      assert(ImportedJobs.all().length === 1, 'a job added after the reset must SURVIVE the next load');
      assert(ImportedJobs.all()[0].title === 'Kept Job', 'and be the right one');

      /* the flag records what happened, for support */
      const flag = JSON.parse(localStorage.getItem(JobDataReset.FLAG_KEY));
      assert(flag && typeof flag.at === 'number' && typeof flag.cleared === 'number', 'the marker records the run: ' + JSON.stringify(flag));
      return 'runs once, later jobs are never wiped, marker recorded';
    }],

    ['6 - Running it again on demand is safe and idempotent', () => {
      reset();
      seedJobData();
      const a = JobDataReset.run();
      const b = JobDataReset.run();
      assert(a.ok && b.ok, 'both runs succeed');
      assert(ImportedJobs.all().length === 0, 'still empty after a second run');
      assert(b.results.length === a.results.length, 'the same targets are reported each time');
      return 'idempotent - a repeat run changes nothing';
    }],

    ['7 - The four screens report zero after the reset', () => {
      reset();
      seedJobData();
      JobDataReset.run();
      const c = JobDataReset.counts();
      assert(c.importedJobs === 0, "Today's Jobs (imported) = " + c.importedJobs);
      assert(c.approvals === 0, 'Approvals = ' + c.approvals);
      assert(c.packages === 0, 'Packages = ' + c.packages);
      assert(c.applications === 0, 'Applications = ' + c.applications);
      assert(c.queue === 0, 'Queue = ' + c.queue);
      return JSON.stringify(c);
    }],

    ['8 - No hard-coded demo jobs remain in the seed data', () => {
      assert(Array.isArray(DB.jobs) && DB.jobs.length === 0, 'DB.jobs must be empty, got ' + DB.jobs.length);
      assert(DB.approvals.length === 0, 'DB.approvals must be empty');
      assert(DB.applications.length === 0, 'DB.applications must be empty');
      assert(JobsStore.jobs().length === 0, "the board's own sample feed must be empty, got " + JobsStore.jobs().length);
      /* dashboard pipeline numbers must not be invented */
      assert(DB.funnel.every(f => f.n === 0), 'the funnel must be all zeros: ' + JSON.stringify(DB.funnel.map(f => f.n)));
      assert(DB.monthly.length === 0, 'no seeded monthly history');
      assert(DB.weekly.every(w => w.pct === 0), 'no seeded weekly activity');
      assert(DB.stats.every(s => /^0|^-|—/.test(String(s.v))), 'no invented headline stats: ' + JSON.stringify(DB.stats.map(s => s.v)));
      return 'no demo jobs, no fake pipeline counts';
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

  /* the real app shares file:// localStorage with this page (CLAUDE.md section 5) */
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
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} - ${r.detail}`));
    console.log(`Job data reset: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await guardedRun()));
})();
