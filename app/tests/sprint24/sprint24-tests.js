/* ============================================================
   Sprint 24 — Application Workflow & Status Management.
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

  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
  const CONSULT = J({ id: 'j-consult', title: 'Technical Consultant', company: 'Beta',
    skills: ['Client delivery', 'Azure', 'SQL'] });

  const TODAY = new Date().toISOString().slice(0, 10);
  const pkgFor = id => ApplicationPackages.forJob(id);
  const cardFor = id => Applications.getItems().find(a => a.jobId === id);

  /* Every case starts from the stock board. Note it cannot start EMPTY:
     ApplicationsStore.load() deliberately falls back to its sample board when
     the saved one is empty, so that a bad write can never blank the screen.
     That is correct product behaviour, so the counter assertions below are
     written as deltas from a baseline rather than assuming zero. */
  function reset() {
    ApplicationPackages.clear();
    CoverLetter.clear();
    ResumeRecommender.clearOverride(ARCH.id);
    ResumeRecommender.clearOverride(CONSULT.id);
    JobsStore.clear();
    JobsStore.setDiscovered([ARCH, CONSULT]);
    Jobs.reload();
    ApplicationsStore.clear();           // back to the stock board
    Applications.reload();
    Applications.ui.open = {};
    DB.approvals = [];
  }

  const CASES = [

    ['1 · Status changes', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      assert(pkg.status === 'ready_to_apply', 'a new package should be Ready to Apply');

      /* all five statuses exist and are selectable from the page */
      assert(ApplicationPackages.STATUSES.join() === 'ready_to_apply,applied,interview,offer,rejected',
        'the five statuses are wrong: ' + ApplicationPackages.STATUSES.join());
      const html = Applications.render();
      assert(html.indexOf('Applications.setPackageStatus') !== -1, 'the status control is missing from the page');
      ['Ready to Apply', 'Applied', 'Interview', 'Offer', 'Rejected']
        .forEach(l => assert(html.indexOf('>' + l + '<') !== -1, 'the status option is missing: ' + l));

      /* walk the workflow */
      Applications.setPackageStatus(pkg.id, 'applied');
      assert(pkgFor(ARCH.id).status === 'applied', 'status did not change to applied');
      Applications.setPackageStatus(pkg.id, 'interview');
      assert(pkgFor(ARCH.id).status === 'interview', 'status did not change to interview');
      Applications.setPackageStatus(pkg.id, 'offer');
      const offered = pkgFor(ARCH.id);
      assert(offered.status === 'offer', 'status did not change to offer');

      /* the change is dated, and only the LATEST status is kept */
      assert(offered.statusChangedOn === TODAY, 'the status change date is wrong: ' + offered.statusChangedOn);
      assert(typeof offered.status === 'string', 'status must be a single value');
      assert(!offered.history && !offered.statusTrail, 'only the latest status should be kept, no trail');
      assert(offered.appliedOn === TODAY, 'the applied date should be stamped once and kept');

      /* Mark as Applied still works and is the same path */
      Applications.setPackageStatus(pkg.id, 'ready_to_apply');
      assert(Applications.markApplied(pkg.id).status === 'applied', 'Mark as Applied broke');
      assert(Applications.markApplied(pkg.id) === null, 'a package was applied twice');

      /* setting the status it already has is not a change */
      const same = ApplicationPackages.setStatus(pkg.id, 'applied');
      assert(same && same.status === 'applied', 'a no-op status set should return the package');
      return 'ready_to_apply → applied → interview → offer · dated · latest status only · Mark as Applied intact';
    }],

    ['2 · Dashboard updates', () => {
      reset();
      const base = Applications.counts();          // the stock board is the baseline

      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      /* a Ready to Apply package is not an application yet — it must not count */
      assert(Applications.counts().total === base.total, 'a Ready to Apply package must not hit the dashboard');
      assert(!cardFor(ARCH.id), 'a Ready to Apply package must not be on the board');

      Applications.setPackageStatus(pkg.id, 'applied');
      let c = Applications.counts();
      assert(c.applied === base.applied + 1 && c.total === base.total + 1,
        'the dashboard did not count the applied application: ' + JSON.stringify(c));

      Applications.setPackageStatus(pkg.id, 'interview');
      c = Applications.counts();
      assert(c.interview === base.interview + 1 && c.applied === base.applied,
        'the counters did not follow the status to interview: ' + JSON.stringify(c));
      assert(c.total === base.total + 1, 'the total drifted on a status change');

      Applications.setPackageStatus(pkg.id, 'offer');
      c = Applications.counts();
      assert(c.offer === base.offer + 1 && c.interview === base.interview,
        'the counters did not follow the status to offer: ' + JSON.stringify(c));
      assert(cardFor(ARCH.id).status === 'offer', 'the board card did not follow the package status');
      assert(Applications.getItems().filter(a => a.jobId === ARCH.id).length === 1, 'a duplicate board card was created');

      Applications.setPackageStatus(pkg.id, 'rejected');
      c = Applications.counts();
      assert(c.rejected === base.rejected + 1 && c.offer === base.offer && c.total === base.total + 1,
        'the counters did not follow to rejected');

      /* the dashboard's own numbers are derived from these counts, so they move too */
      const conv = c.total ? Math.round(((c.interview + c.offer) / c.total) * 100) : 0;
      const baseConv = base.total ? Math.round(((base.interview + base.offer) / base.total) * 100) : 0;
      assert(conv !== baseConv, 'the dashboard conversion rate did not react to the status change');

      /* going back to Ready to Apply takes it off the board again */
      Applications.setPackageStatus(pkg.id, 'ready_to_apply');
      assert(Applications.counts().total === base.total && !cardFor(ARCH.id),
        'reverting to Ready to Apply left a stale card on the board');

      /* a second application counts separately */
      Jobs.approve(CONSULT.id);
      Applications.setPackageStatus(pkgFor(CONSULT.id).id, 'applied');
      assert(Applications.counts().applied === base.applied + 1, 'the second application was miscounted');
      assert(Applications.counts().total === base.total + 1, 'the second application was double counted');
      return 'counters follow every status change · Ready to Apply is not counted · one card per job · reverting clears it';
    }],

    ['3 · Persistence', () => {
      reset();
      const base = Applications.counts();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      Applications.setPackageStatus(pkg.id, 'interview');

      /* a refresh is: read it back from storage with nothing in memory */
      const raw = JSON.parse(localStorage.getItem('careerpilot_platform.' + ApplicationPackages.STORAGE_KEY));
      const stored = Array.isArray(raw) ? raw : raw.value;      // the provider may wrap the record
      const rp = (Array.isArray(stored) ? stored : []).find(p => p.jobId === ARCH.id);
      assert(rp, 'the package is not in localStorage');
      assert(rp.status === 'interview', 'the status did not persist: ' + rp.status);
      assert(rp.statusChangedOn === TODAY, 'the status change date did not persist');

      /* the board card persisted too — that is what the dashboard counts */
      const board = JSON.parse(localStorage.getItem(ApplicationsStore.KEY));
      assert(board.some(a => a.jobId === ARCH.id && a.status === 'interview'), 'the board card did not persist');

      /* re-read everything from storage, as a fresh page load would */
      Applications.reload();
      assert(pkgFor(ARCH.id).status === 'interview', 'the reloaded package lost its status');
      assert(Applications.counts().interview === base.interview + 1, 'the dashboard counters did not survive the refresh');
      assert(Applications.render().indexOf('Interview') !== -1, 'the page does not show the status after a refresh');

      /* a later change also persists */
      Applications.setPackageStatus(pkgFor(ARCH.id).id, 'offer');
      Applications.reload();
      assert(pkgFor(ARCH.id).status === 'offer' && Applications.counts().offer === base.offer + 1,
        'the second change did not persist');
      return 'status + change date + board card + counters all survive a reload from storage';
    }],

    ['4 · Invalid status protection', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      Applications.setPackageStatus(pkg.id, 'applied');
      const good = pkgFor(ARCH.id);
      const before = Applications.counts();

      /* anything outside the five is refused, and nothing changes */
      ['hired', 'APPLIED', 'Applied', '', null, undefined, 'ready', 'discovered', 'withdrawn', 42, {}]
        .forEach(bad => {
          assert(ApplicationPackages.isValidStatus(bad) === false, 'should be invalid: ' + String(bad));
          assert(Applications.setPackageStatus(pkg.id, bad) === null, 'an invalid status was accepted: ' + String(bad));
          const now = pkgFor(ARCH.id);
          assert(now.status === 'applied', 'an invalid status changed the package: ' + String(bad));
          assert(now.statusChangedOn === good.statusChangedOn, 'an invalid status re-dated the package');
        });

      /* the board and the counters were not touched either */
      assert(cardFor(ARCH.id).status === 'applied', 'an invalid status moved the board card');
      const after = Applications.counts();
      assert(JSON.stringify(after) === JSON.stringify(before), 'an invalid status changed the counters');

      /* an unknown package id is refused just as cleanly */
      assert(ApplicationPackages.setStatus('pkg-nope', 'offer') === null, 'a status was set on a package that does not exist');
      assert(ApplicationPackages.all().length === 1, 'a phantom package was created');
      return 'the five statuses are the only ones accepted · package, board and counters are untouched by a bad value';
    }],

    ['5 · Backward compatibility', () => {
      reset();
      const base = Applications.counts();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);

      /* Sprint 23: the package still carries everything it did */
      assert(pkg.job.title === ARCH.title && pkg.resumeId && pkg.coverLetter && typeof pkg.matchScore === 'number',
        'the Sprint 23 package contract was lost');
      assert(ApplicationPackages.forJob(ARCH.id) && ApplicationPackages.all().length === 1, 'duplicate prevention broke');
      const html = Applications.render();
      ['Applications.openPackage', 'Applications.copyPackageCover', 'Applications.setPackageResume', 'Applications.markApplied']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the package lost the ' + k + ' action'));
      assert(Applications.copyPackageCover(pkg.id).ok, 'copy cover letter broke');

      /* the résumé is still editable while Ready, and frozen once sent */
      assert(ApplicationPackages.setResume(pkg.id, 'var2') !== null, 'the résumé should be editable while Ready to Apply');
      Applications.setPackageStatus(pkg.id, 'interview');
      assert(ApplicationPackages.setResume(pkg.id, 'var3') === null, 'a sent package must not be rewritten');

      /* the Kanban board is unchanged: columns, drag and drop, stage badge */
      const board = Applications.render();
      assert(board.indexOf('kboard') !== -1, 'the board disappeared');
      ApplicationsView.COLS.forEach(c => assert(board.indexOf('>' + c.label + '<') !== -1, 'board column lost: ' + c.label));
      ['Applications.drop', 'Applications.dragStart', 'Applications.setStatus']
        .forEach(k => assert(board.indexOf(k) !== -1, 'the board lost ' + k));

      /* dragging a card still works and does not disturb the package */
      Applications.move(cardFor(ARCH.id).id, 'offer');
      assert(cardFor(ARCH.id).status === 'offer', 'moving a card on the board broke');
      assert(Applications.counts().offer === base.offer + 1, 'the counters ignored a board move');

      /* the approval flow, provenance and Sprints 21–22 are intact */
      assert(JobsStore.load().decisions[ARCH.id] === 'approved', 'the approve decision was lost');
      assert(DB.approvals.filter(a => a.fromJob === ARCH.id).length === 1, 'the Approvals queue entry was lost');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the master résumé was touched');
      ['job-resume', 'job-cover', 'Jobs.setResume', 'job-breakdown', 'job-search']
        .forEach(k => assert(Jobs.render().indexOf(k) !== -1, 'the job card lost ' + k));
      return 'Sprint 23 package intact · board + drag/drop + stage badge intact · approval flow and Sprints 21–22 intact';
    }],
  ];

  /* Profile.getState() hands back the LIVE in-memory profile. Pin it to the
     shipped defaults for the run (in place, never saved) so the assertions are
     deterministic no matter what the user has entered, then put it back. */
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
    console.log(`Sprint 24: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
