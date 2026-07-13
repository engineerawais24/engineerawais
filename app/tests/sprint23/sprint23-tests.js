/* ============================================================
   Sprint 23 — Application Package Preparation.
   Browser harness. Snapshots localStorage and restores it, so no
   existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/' + o.id,
      postedDate: '2026-07-08', salary: 150, salaryDisclosed: true, workMode: 'Remote',
      location: 'Remote · US', description: 'A posting.',
    }, o));
  }

  /* an architect role → recommends the Stripe "Sr Solutions Architect" résumé (var1) */
  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
  const CONSULT = J({ id: 'j-consult', title: 'Technical Consultant', company: 'Beta',
    skills: ['Client delivery', 'Azure', 'SQL'] });

  const nameOf = id => (ResumeRecommender.candidates().find(c => c.id === id) || {}).name;
  const itemFor = id => Jobs.evaluated().find(x => x.job.id === id);

  /* every case starts from the same clean slate */
  function reset() {
    ApplicationPackages.clear();
    CoverLetter.clear();
    ResumeRecommender.clearOverride(ARCH.id);
    ResumeRecommender.clearOverride(CONSULT.id);
    ApplicationsStore.clear();
    JobsStore.clear();
    JobsStore.setDiscovered([ARCH, CONSULT]);
    Jobs.reload();
    Applications.reload();
    Applications.ui.open = {};
    DB.approvals = [];
  }

  const CASES = [

    ['1 · Package creation', () => {
      reset();
      assert(ApplicationPackages.all().length === 0, 'should start with no packages');

      Jobs.approve(ARCH.id);                       // the real Approve button

      const pkgs = ApplicationPackages.all();
      assert(pkgs.length === 1, 'approving should create exactly one package, got ' + pkgs.length);
      const pkg = pkgs[0];

      /* every field the package must carry */
      assert(pkg.jobId === ARCH.id, 'the package is not linked to the job');
      assert(pkg.job.title === ARCH.title && pkg.job.company === ARCH.company, 'job details missing');
      assert(pkg.job.location === ARCH.location && pkg.job.applyUrl === ARCH.applyUrl, 'job details incomplete');
      assert(pkg.resumeId && pkg.resumeName, 'the selected résumé is missing');
      assert(pkg.coverLetter && pkg.coverLetter.length > 100, 'the cover letter is missing');
      assert(typeof pkg.matchScore === 'number' && pkg.matchScore === itemFor(ARCH.id).res.score,
        'the match score is wrong: ' + pkg.matchScore);
      assert(pkg.approvedOn === new Date().toISOString().slice(0, 10), 'the approval date is wrong: ' + pkg.approvedOn);
      assert(pkg.status === 'ready_to_apply', 'status should be ready_to_apply, got ' + pkg.status);
      assert(ApplicationPackages.statusLabel(pkg.status) === 'Ready to Apply', 'status label wrong');

      /* saved through the existing platform storage — no new system */
      assert(localStorage.getItem('careerpilot_platform.' + ApplicationPackages.STORAGE_KEY) !== null,
        'the package is not in the platform storage namespace');

      /* it shows on the existing Applications page, with all four actions */
      const html = Applications.render();
      assert(html.indexOf('Ready to Apply') !== -1, 'the package is not shown on the Applications page');
      assert(html.indexOf(ARCH.company) !== -1 && html.indexOf(ARCH.title) !== -1, 'the job is not shown on the package');
      assert(html.indexOf(pkg.matchScore + '% match') !== -1, 'the match score is not shown');
      ['Applications.openPackage', 'Applications.copyPackageCover', 'Applications.setPackageResume', 'Applications.markApplied']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the package is missing the ' + k + ' action'));

      /* Open package reveals the job details and the letter */
      Applications.openPackage(pkg.id);
      const open = Applications.render();
      assert(open.indexOf('pkg-detail') !== -1 && open.indexOf('pkg-cover') !== -1, 'Open package did not expand the package');
      assert(open.indexOf('Cloud migration') !== -1, 'the expanded package does not list the job’s skills');
      return `1 package · ${pkg.resumeName} · match ${pkg.matchScore}% · ${pkg.status} · ${pkg.coverLetter.length}-char letter`;
    }],

    ['2 · Correct résumé and cover letter saved', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = ApplicationPackages.forJob(ARCH.id);

      /* it captured the résumé actually selected for the job (Sprint 21) */
      const selected = ResumeRecommender.forJob(ARCH).selected;
      assert(pkg.resumeId === selected.id && selected.id === 'var1', 'wrong résumé saved: ' + pkg.resumeId);
      assert(pkg.resumeName === nameOf('var1'), 'wrong résumé name saved: ' + pkg.resumeName);

      /* …and the cover letter written for that résumé (Sprint 22) */
      assert(pkg.coverLetter === CoverLetter.get(ARCH.id).text, 'the saved letter is not the job’s cover letter');
      assert(pkg.coverLetterResumeId === 'var1', 'the letter was written against a different résumé');
      assert(pkg.coverLetter.indexOf(nameOf('var1')) !== -1, 'the letter does not name the selected résumé');
      assert(pkg.coverLetter.indexOf(ARCH.company) !== -1, 'the letter is not for this job');

      /* changing the package's résumé rewrites the letter to match */
      Applications.setPackageResume(pkg.id, 'var2');
      const after = ApplicationPackages.forJob(ARCH.id);
      assert(after.resumeId === 'var2' && after.resumeName === nameOf('var2'), 'the résumé did not change');
      assert(after.coverLetterResumeId === 'var2', 'the letter was not rewritten for the new résumé');
      assert(after.coverLetter.indexOf(nameOf('var2')) !== -1, 'the letter does not name the new résumé');
      assert(after.coverLetter.indexOf(nameOf('var1')) === -1, 'the letter still names the old résumé');
      assert(after.coverLetter !== pkg.coverLetter, 'the letter text did not change with the résumé');
      assert(Applications.render().indexOf(nameOf('var2')) !== -1, 'the page does not show the new résumé');

      /* the job card and the package never disagree about the résumé */
      assert(CoverLetter.get(ARCH.id).resumeId === 'var2', 'the job card’s letter is out of sync');
      Jobs.setResume(ARCH.id, 'var3');                     // changed from the job card instead
      Applications.render();                                // …the package heals on render
      assert(ApplicationPackages.forJob(ARCH.id).resumeId === 'var3', 'the package did not follow the job card’s résumé');

      /* copy hands back exactly what is in the package */
      const copied = Applications.copyPackageCover(pkg.id);
      assert(copied.ok && copied.text === ApplicationPackages.forJob(ARCH.id).coverLetter, 'copy returned the wrong text');
      return 'résumé + letter captured on approve · changing either keeps them in sync · copy returns the package letter';
    }],

    ['3 · Duplicate prevention', () => {
      reset();
      Jobs.approve(ARCH.id);
      const first = ApplicationPackages.forJob(ARCH.id);

      /* approving the same job again must not create a second package */
      Jobs.approve(ARCH.id);
      Jobs.approve(ARCH.id);
      assert(ApplicationPackages.all().length === 1, 'duplicate package created: ' + ApplicationPackages.all().length);
      assert(ApplicationPackages.forJob(ARCH.id).id === first.id, 'the package id changed on re-approve');
      assert(ApplicationPackages.forJob(ARCH.id).approvedAt === first.approvedAt, 'the original package was overwritten');

      /* calling the factory directly is just as protected */
      const again = ApplicationPackages.createFrom(itemFor(ARCH.id));
      assert(again.id === first.id && ApplicationPackages.all().length === 1, 'createFrom created a duplicate');

      /* a different job still gets its own package */
      Jobs.approve(CONSULT.id);
      assert(ApplicationPackages.all().length === 2, 'a second job should get its own package');
      assert(ApplicationPackages.forJob(CONSULT.id).id !== first.id, 'the two jobs share a package');

      /* undoing an approval withdraws the not-yet-applied package */
      Jobs.undo(CONSULT.id);
      assert(!ApplicationPackages.has(CONSULT.id), 'undo left an orphaned package');
      assert(ApplicationPackages.has(ARCH.id), 'undo removed the wrong package');
      return 'one package per job · re-approve is a no-op · other jobs unaffected · undo withdraws an unsent package';
    }],

    ['4 · Mark as Applied', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = ApplicationPackages.forJob(ARCH.id);
      const boardBefore = Applications.getItems().length;

      const applied = Applications.markApplied(pkg.id);
      assert(applied && applied.status === 'applied', 'the package was not marked applied');
      assert(applied.appliedOn === new Date().toISOString().slice(0, 10), 'the applied date is wrong');
      assert(ApplicationPackages.forJob(ARCH.id).status === 'applied', 'the applied status was not saved');

      /* it lands on the existing board, exactly once */
      const board = Applications.getItems();
      assert(board.length === boardBefore + 1, 'the applied package did not reach the board');
      const card = board.find(a => a.jobId === ARCH.id);
      assert(card && card.status === 'applied', 'the board card is missing or in the wrong column');
      assert(card.company === ARCH.company && card.position === ARCH.title, 'the board card has the wrong job');

      /* applying twice does nothing */
      assert(Applications.markApplied(pkg.id) === null, 'a package was applied twice');
      assert(Applications.getItems().filter(a => a.jobId === ARCH.id).length === 1, 'a duplicate board card was created');

      /* the applied package is now a record: it is no longer offered for editing */
      const html = Applications.render();
      assert(html.indexOf('is-applied') !== -1, 'the package is not shown as applied');
      assert(ApplicationPackages.setResume(pkg.id, 'var2') === null, 'an applied package must not be rewritten');
      assert(ApplicationPackages.forJob(ARCH.id).resumeId === 'var1', 'an applied package’s résumé changed');
      assert(ApplicationPackages.all().length === 1, 'marking as applied changed the package count');

      /* nothing was submitted anywhere — this only records what the user did */
      assert(html.indexOf('0 ready to apply') !== -1, 'the ready count did not drop after applying');
      return 'status → applied · dated · one board card · cannot be applied twice · frozen once sent';
    }],

    ['5 · Persistence after refresh', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = ApplicationPackages.forJob(ARCH.id);
      Applications.markApplied(pkg.id);

      /* a refresh is: read it back from storage with nothing in memory */
      const raw = JSON.parse(localStorage.getItem('careerpilot_platform.' + ApplicationPackages.STORAGE_KEY));
      const stored = Array.isArray(raw) ? raw : raw.value;      // provider may wrap the record
      const rp = (Array.isArray(stored) ? stored : []).find(p => p.jobId === ARCH.id);
      assert(rp, 'the package is not in localStorage at all');
      assert(rp.status === 'applied' && rp.appliedOn, 'the status did not survive the refresh');
      assert(rp.resumeId === pkg.resumeId && rp.resumeName === pkg.resumeName, 'the résumé did not survive');
      assert(rp.coverLetter === pkg.coverLetter, 'the cover letter did not survive');
      assert(rp.matchScore === pkg.matchScore && rp.approvedOn === pkg.approvedOn, 'score/date did not survive');
      assert(rp.job.title === ARCH.title, 'the job details did not survive');

      /* the module re-reads from storage, so a fresh page sees the same thing */
      Applications.reload();
      const after = ApplicationPackages.forJob(ARCH.id);
      assert(after.status === 'applied' && after.coverLetter === pkg.coverLetter, 'the reloaded package differs');
      assert(Applications.getItems().some(a => a.jobId === ARCH.id && a.status === 'applied'),
        'the board card did not survive the refresh');
      assert(Applications.render().indexOf(ARCH.company) !== -1, 'the package is gone from the page after a refresh');
      return 'package + status + résumé + letter + board card all survive a reload from storage';
    }],

    ['6 · Backward compatibility', () => {
      reset();
      Jobs.approve(ARCH.id);

      /* the Kanban board is unchanged: four columns, sample cards, drag handlers */
      const html = Applications.render();
      assert(html.indexOf('kboard') !== -1, 'the board disappeared');
      ApplicationsView.COLS.forEach(c => assert(html.indexOf('>' + c.label + '<') !== -1, 'board column lost: ' + c.label));
      assert(html.indexOf('Applications.drop') !== -1 && html.indexOf('Applications.dragStart') !== -1, 'drag and drop was lost');
      assert(html.indexOf('Applications.setStatus') !== -1, 'the stage badge was lost');
      const counts = Applications.counts();
      assert(typeof counts.applied === 'number' && counts.total === Applications.getItems().length, 'counts() broke');

      /* the old one-argument view signature still works */
      assert(ApplicationsView.render(Applications.getItems()).indexOf('kboard') !== -1, 'ApplicationsView.render(items) broke');

      /* the existing approval flow is intact — decision, Approvals queue,
         provenance — and the master résumé is still untouched */
      assert(JobsStore.load().decisions[ARCH.id] === 'approved', 'the approve decision was lost');
      assert(DB.approvals.filter(a => a.fromJob === ARCH.id).length === 1, 'the Approvals queue entry was lost');
      assert(DB.approvals[0].resumeVersion && DB.approvals[0].resumeVersion.from, 'résumé provenance was lost');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the master résumé was touched');

      /* Sprints 21–22 still work on the job card */
      const jobsHtml = Jobs.render();
      ['job-resume', 'job-cover', 'Jobs.setResume', 'job-breakdown', 'job-search']
        .forEach(k => assert(jobsHtml.indexOf(k) !== -1, 'the job card lost ' + k));

      /* a package is a draft — creating one never submits anything */
      assert(ApplicationPackages.forJob(ARCH.id).status === 'ready_to_apply', 'a package must not auto-apply');
      assert(!Applications.getItems().some(a => a.jobId === ARCH.id), 'an unapplied package must not reach the board');
      return 'board + drag/drop + counts intact · approval flow, Approvals queue and provenance intact · Sprints 21–22 intact · nothing auto-applies';
    }],
  ];

  /* Profile.getState() hands back the LIVE in-memory profile. Pin it to the
     shipped defaults for the run (in place, never saved) so the assertions
     are deterministic no matter what the user has entered, then put it back. */
  function pinProfile() {
    const p = Profile.getState();
    const snapshot = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.demo();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snapshot);
    };
  }

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const restoreProfile = pinProfile();
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_applications_v1', 'careerpilot_master_resume_v1',
        'careerpilot_platform.resume_overrides', 'careerpilot_platform.cover_letters',
        'careerpilot_platform.application_packages']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      CASES.forEach(([name, fn]) => {
        try { results.push({ name, pass: true, detail: fn() || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      });
    } finally {
      restoreProfile();
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
    console.log(`Sprint 23: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
