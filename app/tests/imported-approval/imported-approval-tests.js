/* ============================================================
   Saved job → Approved → Create application → Approvals → Queue.

   Real ImportedJobs + ApplicationPackages + QueueView + ApplicationQueue.
   localStorage is snapshotted and restored; window.open is stubbed.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  const opened = [];
  const realOpen = window.open;
  window.open = url => { opened.push(url); return { closed: false, focus() {} }; };

  /* a saved job as JobsBackendSync.upsertFromBackend leaves it (Oracle ATS) */
  function makeApprovedImport(id, url) {
    const u = url || ('https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/preview/' + id);
    const up = ImportedJobs.upsertFromBackend({
      id, source: 'Company Careers', title: 'WSP — Work Summary ' + id, company: 'WSP',
      apply_url: u, canonical_url: u, description: '', work_mode: '', salary_disclosed: false,
    });
    ImportedJobs.setStatus(up.job.id, 'approved');
    return up.job.id;
  }
  function reset() { ImportedJobs.clear(); ApplicationPackages.clear(); ApplicationQueue.finish(); opened.length = 0; }

  const CASES = [

    ['1 · saved → approved → create app → visible in Approvals → queued', () => {
      reset();
      const jobId = makeApprovedImport('1');

      const res = ImportedJobs.createApplication(jobId);
      assert(res.ok && res.pkg && res.pkg.status === 'ready_to_apply', 'creating an application must produce a ready package: ' + JSON.stringify(res));

      /* visible under Approvals — the exact list the Approvals card renders */
      assert(QueueView.readyApplications().some(p => p.jobId === jobId), 'the package must be visible under Approvals');
      const html = QueueView.applicationsCard();
      assert(/WSP — Work Summary 1/.test(html) && /Approve &amp; queue/.test(html), 'Approvals card shows the job + an Approve & queue action');

      /* Approve & queue → that exact job is in the Application Queue */
      const q = ApplicationQueue.enqueue(jobId);
      assert(q.ok, 'enqueue should succeed: ' + JSON.stringify(q));
      assert(ApplicationQueue.isQueued(jobId), 'the exact job must now be in the Application Queue');
      const s = ApplicationQueue.state();
      assert(s.active && s.order.indexOf(jobId) !== -1 && s.currentId === jobId, 'the queue holds this exact job');
      assert(opened.length === 0, 'Approve & queue must NOT open a tab');
      return 'created · visible in Approvals · queued (exact job) · no tab opened';
    }],

    ['2 · Creating an application twice is prevented (no duplicate)', () => {
      reset();
      const jobId = makeApprovedImport('2');
      assert(ImportedJobs.createApplication(jobId).ok, 'first create succeeds');
      const again = ImportedJobs.createApplication(jobId);
      assert(!again.ok && /already exists/i.test(again.error), 'second create must be refused: ' + JSON.stringify(again));
      assert(ApplicationPackages.all().filter(p => p.jobId === jobId).length === 1, 'exactly one package for the job');
      return 'one job → one application';
    }],

    ['3 · Existing applications are preserved; only the chosen job is queued', () => {
      reset();
      const a = makeApprovedImport('a'), b = makeApprovedImport('b');
      ImportedJobs.createApplication(a);
      ImportedJobs.createApplication(b);
      assert(ApplicationPackages.ready().length === 2, 'both applications exist');
      const ids = QueueView.readyApplications().map(p => p.jobId);
      assert(ids.indexOf(a) !== -1 && ids.indexOf(b) !== -1, 'both visible under Approvals');

      ApplicationQueue.enqueue(a);
      assert(ApplicationQueue.isQueued(a), 'a is queued');
      assert(!ApplicationQueue.isQueued(b), 'b is NOT auto-queued — only the chosen job');
      assert(ApplicationPackages.forJob(b).status === 'ready_to_apply', 'b\'s application is preserved');
      assert(QueueView.readyApplications().some(p => p.jobId === b), 'b is still visible under Approvals');
      return 'both preserved · only the chosen job queued';
    }],

    ['4 · Approve & queue appends to an active queue without duplicating', () => {
      reset();
      const a = makeApprovedImport('a'), b = makeApprovedImport('b'), c = makeApprovedImport('c');
      [a, b, c].forEach(id => ImportedJobs.createApplication(id));
      ApplicationQueue.enqueue(a);                 // fresh → [a]
      ApplicationQueue.enqueue(b);                 // active → append → [a, b]
      const s = ApplicationQueue.state();
      assert(s.order.length === 2 && s.order.indexOf(a) !== -1 && s.order.indexOf(b) !== -1, 'a and b are queued');
      assert(!ApplicationQueue.isQueued(c), 'c is not queued');
      ApplicationQueue.enqueue(b);                 // again → no-op
      assert(ApplicationQueue.state().order.filter(x => x === b).length === 1, 'no duplicate in the queue order');
      return 'appended once · never duplicated';
    }],

    ['5 · enqueue guards: no application / already applied', () => {
      reset();
      const jobId = makeApprovedImport('x');       // approved, but NO application yet
      const r1 = ApplicationQueue.enqueue(jobId);
      assert(!r1.ok && /no application/i.test(r1.error), 'cannot queue a job that has no application: ' + JSON.stringify(r1));

      ImportedJobs.createApplication(jobId);
      ApplicationPackages.markApplied('pkg-' + jobId);  // now applied
      const r2 = ApplicationQueue.enqueue(jobId);
      assert(!r2.ok && /not ready/i.test(r2.error), 'cannot queue an already-applied job: ' + JSON.stringify(r2));
      return 'guards: no-application & already-applied refused';
    }],

    ['6 · Approvals card never double-lists a job already shown as a Prep package', () => {
      reset();
      const jobId = makeApprovedImport('d');
      ImportedJobs.createApplication(jobId);
      window.Prep = { packages: () => [{ jobId }] };   // pretend a Prep package exists for it
      assert(!QueueView.readyApplications().some(p => p.jobId === jobId), 'a job already in Prep must not be re-listed');
      delete window.Prep;
      assert(QueueView.readyApplications().some(p => p.jobId === jobId), 'without a Prep entry it IS listed');
      return 'no double-listing with the Prep card';
    }],

    ['7 · Two saved jobs with a shared canonical URL keep SEPARATE packages (WSP ↔ Microsoft)', () => {
      reset();
      /* Oracle/SPA ATS: the requisition id is in the query, so both URLs
         canonicalize the same — the exact bug that merged WSP into Microsoft */
      const base = 'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/candidateApplication?requisitionId=';
      const ms = ImportedJobs.upsertFromBackend({ id: 500, source: 'Company Careers', source_job_id: 'ext-ms', title: 'Technical Consultant', company: 'Microsoft', apply_url: base + '1000', canonical_url: base + '1000', description: '', work_mode: '', salary_disclosed: false });
      const wsp = ImportedJobs.upsertFromBackend({ id: 501, source: 'Company Careers', source_job_id: 'ext-wsp', title: 'WSP — Work Summary', company: 'WSP', apply_url: base + '2000', canonical_url: base + '2000', description: '', work_mode: '', salary_disclosed: false });
      assert(ms.ok && !ms.duplicate, 'Microsoft imported');
      assert(wsp.ok && !wsp.duplicate, 'WSP must NOT be treated as a duplicate of Microsoft: ' + JSON.stringify(wsp));
      assert(ms.job.id !== wsp.job.id && ms.job.company === 'Microsoft' && wsp.job.company === 'WSP', 'two distinct jobs, each its own company');

      ImportedJobs.setStatus(ms.job.id, 'approved'); ImportedJobs.setStatus(wsp.job.id, 'approved');
      ImportedJobs.createApplication(ms.job.id); ImportedJobs.createApplication(wsp.job.id);
      assert(ApplicationPackages.all().length === 2, 'two separate application packages');
      assert(ApplicationPackages.forJob(wsp.job.id).job.company === 'WSP', 'WSP\'s package shows WSP');
      assert(ApplicationPackages.forJob(ms.job.id).job.company === 'Microsoft', 'Microsoft\'s package shows Microsoft');

      ApplicationQueue.enqueue(wsp.job.id);
      assert(ApplicationQueue.current().job.company === 'WSP', 'the queued WSP job links to its OWN package, never Microsoft');
      return 'shared canonical URL → separate jobs · separate packages · no cross-link';
    }],
  ];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function run() {
    return CASES.map(([name, fn]) => {
      try { return { name, pass: true, detail: fn() || '' }; }
      catch (e) { return { name, pass: false, detail: e.message }; }
    });
  }

  function guardedRun() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    let results;
    try { localStorage.clear(); results = run(); }
    finally {
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
      window.open = realOpen;
      delete window.Prep;
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
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Imported approval → queue: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(guardedRun()));
})();
