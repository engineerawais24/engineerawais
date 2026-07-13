/* ============================================================
   Sprint 26 — Real Job Import and Approval Workflow.
   Browser harness. localStorage is snapshotted and restored, so no
   existing user data is touched. Nothing here fetches a URL.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* a realistic posting, pasted by hand — the skills are read out of the text */
  const GOOD = {
    url: 'https://boards.greenhouse.io/acme/jobs/4411?utm_source=newsletter',
    title: 'Senior Solutions Engineer',
    company: 'Acme Cloud',
    location: 'Dubai, United Arab Emirates',
    workplaceType: 'Hybrid',
    source: '',
    salary: '160',
    postedDate: '2026-07-10',
    description: 'We are looking for a Senior Solutions Engineer to own technical evaluations for '
      + 'enterprise customers. You will work with Terraform and Kubernetes across cloud migrations, '
      + 'lead Client delivery, and be comfortable with Payments integrations.',
  };

  function reset() {
    ImportedJobs.clear();
    ApplicationPackages.clear();
    CoverLetter.clear();
    ApplicationsStore.clear();
    Applications.reload();
    Imports.ui.formOpen = false;
    Imports.ui.showRejected = false;
    Imports.ui.errors = {};
    Imports.ui.open = {};
    Imports.ui.form = { url: '', title: '', company: '', location: '', workplaceType: 'On Site', source: '', salary: '', postedDate: '', description: '' };
  }

  function importGood(over) {
    return ImportedJobs.create(Object.assign({}, GOOD, over || {}));
  }

  const CASES = [

    ['1 · Required field validation', () => {
      reset();
      const empty = ImportedJobs.create({});
      assert(empty.ok === false, 'an empty form was accepted');
      ['title', 'company', 'url', 'description'].forEach(f =>
        assert(empty.errors[f], 'no validation message for the required field: ' + f));
      assert(!empty.errors.location && !empty.errors.salary, 'an optional field was reported as required');
      assert(ImportedJobs.all().length === 0, 'an invalid job was saved anyway');

      /* each required field is reported on its own */
      const noDesc = ImportedJobs.create(Object.assign({}, GOOD, { description: '   ' }));
      assert(noDesc.ok === false && noDesc.errors.description, 'a blank description was accepted');
      assert(!noDesc.errors.title && !noDesc.errors.company && !noDesc.errors.url, 'unrelated fields were flagged');

      /* the controller surfaces the errors inline on the open form, exactly as
         a user filling it in would see them */
      Imports.toggleForm();
      assert(Imports.ui.formOpen === true, 'the import form did not open');
      Object.keys(GOOD).forEach(k => Imports.setField(k, GOOD[k]));
      Imports.setField('company', '');
      const res = Imports.submit();
      assert(res.ok === false && Imports.ui.errors.company, 'the form did not keep the inline error');
      assert(Imports.ui.formOpen === true, 'the form closed on a validation error — the message would be invisible');
      const html = Imports.render();
      assert(html.indexOf('ferr') !== -1, 'no inline validation message is rendered');
      assert(html.indexOf('Company is required') !== -1, 'the message is not the one for this field');
      assert(ImportedJobs.all().length === 0, 'a job was saved despite a validation error');

      /* optional fields really are optional */
      reset();
      const minimal = ImportedJobs.create({
        url: GOOD.url, title: GOOD.title, company: GOOD.company, description: GOOD.description,
      });
      assert(minimal.ok === true, 'the four required fields alone should be enough');
      assert(minimal.job.source === 'Imported', 'the source should default to "Imported", got ' + minimal.job.source);
      assert(minimal.job.salary === null && minimal.job.postedDate === null, 'the optional fields should be null');
      return 'four required fields enforced individually · optionals optional · source defaults to "Imported"';
    }],

    ['2 · Invalid URL handling', () => {
      reset();
      ['not a url', 'careers.acme.com/jobs/1', 'ftp://acme.com/job', 'javascript:alert(1)', 'http://', 'https://acme']
        .forEach(bad => {
          assert(ImportedJobs.isValidUrl(bad) === false, 'should be an invalid URL: ' + bad);
          const res = ImportedJobs.create(Object.assign({}, GOOD, { url: bad }));
          assert(res.ok === false, 'an invalid URL was accepted: ' + bad);
          assert(/valid job URL/i.test(res.errors.url), 'the URL message is unclear for: ' + bad);
        });
      assert(ImportedJobs.all().length === 0, 'a job with an invalid URL was saved');

      ['https://boards.greenhouse.io/acme/jobs/4411', 'http://careers.acme.co.uk/job/22']
        .forEach(good => assert(ImportedJobs.isValidUrl(good) === true, 'should be a valid URL: ' + good));

      const ok = importGood();
      assert(ok.ok === true, 'a valid URL was rejected');
      assert(ok.job.url === GOOD.url, 'the URL the user pasted was not stored verbatim');
      return 'protocol, host and shape validated · the page behind the URL is never fetched';
    }],

    ['3 · Duplicate URL prevention', () => {
      reset();
      const first = importGood();
      assert(first.ok, 'the first import failed');

      const again = importGood();
      assert(again.ok === false, 'the same URL was imported twice');
      assert(/already imported/i.test(again.errors.url), 'the duplicate message is unclear: ' + again.errors.url);
      assert(again.errors.url.indexOf(GOOD.company) !== -1, 'the message should name the existing job');
      assert(ImportedJobs.all().length === 1, 'a duplicate was stored: ' + ImportedJobs.all().length);

      /* the same posting with tracking params or a trailing slash is still a duplicate */
      ['https://boards.greenhouse.io/acme/jobs/4411',
        'https://boards.greenhouse.io/acme/jobs/4411/',
        'https://www.boards.greenhouse.io/acme/jobs/4411?src=twitter#apply']
        .forEach(variant => {
          const dup = ImportedJobs.create(Object.assign({}, GOOD, { url: variant }));
          assert(dup.ok === false, 'a duplicate slipped through as: ' + variant);
        });
      assert(ImportedJobs.all().length === 1, 'duplicates were stored');

      /* a genuinely different posting still imports */
      const other = importGood({ url: 'https://jobs.lever.co/beta/9912', company: 'Beta Systems' });
      assert(other.ok === true, 'a different URL was blocked');
      assert(ImportedJobs.all().length === 2, 'the second job was not stored');
      return 'the same URL is refused, including tracking params, www and a trailing slash';
    }],

    ['4 · Imported job persistence', () => {
      reset();
      const res = importGood();
      const job = res.job;

      assert(job.id && job.id.indexOf('imp-') === 0, 'the job has no unique import id: ' + job.id);
      assert(job.createdOn === new Date().toISOString().slice(0, 10), 'the created date is wrong');
      assert(typeof job.createdAt === 'number', 'the created timestamp is missing');
      assert(importGood({ url: 'https://jobs.lever.co/beta/1' }).job.id !== job.id, 'ids are not unique');

      /* stored through the existing platform layer */
      const raw = JSON.parse(localStorage.getItem('careerpilot_platform.' + ImportedJobs.STORAGE_KEY));
      const stored = Array.isArray(raw) ? raw : raw.value;
      const rec = (Array.isArray(stored) ? stored : []).find(j => j.id === job.id);
      assert(rec, 'the imported job is not in localStorage');
      assert(rec.title === GOOD.title && rec.url === GOOD.url && rec.description === GOOD.description,
        'the imported job did not survive intact');

      /* a refresh re-reads it from storage */
      assert(ImportedJobs.get(job.id).title === GOOD.title, 'the job is not readable back');
      assert(Imports.render().indexOf(GOOD.company) !== -1, 'the job is not rendered after a refresh');

      /* importing does not overwrite anything that was already there */
      const before = JobsStore.load().discovered;
      const decisions = JSON.stringify(JobsStore.load().decisions);
      importGood({ url: 'https://jobs.lever.co/gamma/7', company: 'Gamma' });
      assert(JSON.stringify(JobsStore.load().decisions) === decisions, 'importing changed the board decisions');
      assert(JSON.stringify(JobsStore.load().discovered) === JSON.stringify(before), 'importing changed the sourced board');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'importing touched the master résumé');
      assert(ImportedJobs.all().length === 3, 'the imported jobs were lost');
      return '3 jobs · unique ids · created date · survives a reload · nothing else in storage is touched';
    }],

    ['5 · Match scoring integration', () => {
      reset();
      const job = importGood().job;
      const snap = JobMatchEngine.snapshotFromProfile(ProfileStore.demo());

      /* the skills are read out of the pasted description */
      ['Terraform', 'Kubernetes', 'Client delivery'].forEach(s =>
        assert(job.skills.indexOf(s) !== -1, 'a skill in the description was not extracted: ' + s));
      assert(job.skills.indexOf('Payments') !== -1, 'a skill the profile lacks was not extracted');

      /* scored by the EXISTING Sprint 25 engine, not a second one */
      const m = ImportedJobs.match(job, snap);
      const direct = JobMatchEngine.score(ImportedJobs.toDiscoveryJob(job), snap);
      assert(m.percentage === direct.percentage, 'imported jobs are not scored by JobMatchEngine');
      assert(typeof m.percentage === 'number' && m.percentage >= 0 && m.percentage <= 100,
        'the match percentage is out of range: ' + m.percentage);

      /* matched vs missing skills are honest */
      ['Terraform', 'Kubernetes', 'Client delivery'].forEach(s =>
        assert(m.matchedSkills.indexOf(s) !== -1, 'a profile skill was not matched: ' + s));
      assert(m.missingSkills.indexOf('Payments') !== -1, 'a skill the profile lacks is not listed as missing');
      assert(m.matchedSkills.indexOf('Payments') === -1, 'a skill the profile lacks was claimed as matched');

      /* a short explanation, and all of it on the card */
      const why = ImportedJobs.explain(m);
      assert(why && why.length > 0, 'there is no match explanation');
      const html = Imports.render();
      assert(html.indexOf(m.percentage + '%') !== -1, 'the match percentage is not on the card');
      assert(html.indexOf('Terraform') !== -1, 'the matched skills are not on the card');
      assert(html.indexOf('Payments') !== -1, 'the missing skills are not on the card');
      assert(html.indexOf(esc(why)) !== -1, 'the match explanation is not on the card');

      /* an unrelated posting scores far lower */
      const poor = importGood({
        url: 'https://jobs.lever.co/beta/2', title: 'Graphic Designer', company: 'Beta',
        description: 'Design brand assets in Photoshop and Illustrator. Typography matters.',
      }).job;
      const pm = ImportedJobs.match(poor, snap);
      assert(pm.percentage < m.percentage, 'an unrelated job did not score lower');
      return `${m.percentage}% · matched ${m.matchedSkills.length} · missing ${m.missingSkills.length} · scored by JobMatchEngine`;
    }],

    ['6 · Status changes', () => {
      reset();
      const job = importGood().job;
      assert(job.status === 'new', 'a new import should start at New');
      assert(ImportedJobs.STATUSES.join() === 'new,shortlisted,rejected,approved', 'the four statuses are wrong');

      /* the card offers the status control */
      const html = Imports.render();
      assert(html.indexOf('Imports.setStatus') !== -1, 'the status control is missing from the card');
      ['New', 'Shortlisted', 'Rejected', 'Approved'].forEach(l =>
        assert(html.indexOf('>' + l + '<') !== -1, 'the status option is missing: ' + l));

      Imports.setStatus(job.id, 'shortlisted');
      assert(ImportedJobs.get(job.id).status === 'shortlisted', 'the status did not change');
      assert(ImportedJobs.get(job.id).statusChangedOn === new Date().toISOString().slice(0, 10),
        'the status change was not dated');

      Imports.setStatus(job.id, 'approved');
      assert(ImportedJobs.get(job.id).status === 'approved', 'the job could not be approved');

      /* an unknown status is refused and changes nothing */
      ['hired', 'APPROVED', '', null, undefined, 42, {}].forEach(bad => {
        assert(ImportedJobs.isValidStatus(bad) === false, 'should be invalid: ' + String(bad));
        assert(Imports.setStatus(job.id, bad) === null, 'an invalid status was accepted: ' + String(bad));
        assert(ImportedJobs.get(job.id).status === 'approved', 'an invalid status changed the job');
      });

      /* the status persists */
      assert(ImportedJobs.all().find(j => j.id === job.id).status === 'approved', 'the status was not saved');
      return 'new → shortlisted → approved · dated · invalid status refused · persisted';
    }],

    ['7 · Rejected job filtering', () => {
      reset();
      const keep = importGood().job;
      const drop = importGood({ url: 'https://jobs.lever.co/beta/3', company: 'Beta' }).job;

      Imports.setStatus(drop.id, 'rejected');

      /* kept in storage, hidden from the default view */
      assert(ImportedJobs.all().length === 2, 'a rejected job was deleted rather than kept');
      assert(ImportedJobs.get(drop.id).status === 'rejected', 'the rejection was not stored');
      assert(ImportedJobs.active().map(j => j.id).join() === keep.id, 'the rejected job is still in the active view');
      assert(ImportedJobs.rejected().map(j => j.id).join() === drop.id, 'the rejected job is not in the rejected view');

      assert(Imports.ui.showRejected === false, 'the default view should be the active one');
      let html = Imports.render();
      assert(html.indexOf(keep.company) !== -1, 'the active job is not shown');
      assert(html.indexOf('>Beta<') === -1, 'a rejected job is showing in the default view');
      assert(html.indexOf('Imports.toggleRejected') !== -1, 'there is no filter to view rejected jobs');

      /* the filter reveals them */
      Imports.toggleRejected();
      assert(Imports.ui.showRejected === true, 'the rejected filter did not turn on');
      html = Imports.render();
      assert(html.indexOf('Beta') !== -1, 'the rejected job is not shown under the filter');
      assert(html.indexOf(keep.company) === -1, 'an active job is showing under the rejected filter');

      /* and it can be brought back */
      Imports.toggleRejected();
      Imports.setStatus(drop.id, 'shortlisted');
      assert(ImportedJobs.active().length === 2, 'un-rejecting did not restore the job');
      return 'rejected jobs are kept, hidden by default, and reachable through the filter';
    }],

    ['8 · Approved job creates an application', () => {
      reset();
      const job = importGood().job;

      /* only an approved job may become an application */
      const early = Imports.createApplication(job.id);
      assert(early.ok === false && /approve/i.test(early.error), 'a job was applied for before approval');
      assert(!ApplicationPackages.forJob(job.id), 'an application was created before approval');
      assert(Imports.render().indexOf('Create Application') === -1, 'the action is offered before approval');

      Imports.setStatus(job.id, 'approved');
      assert(Imports.render().indexOf('Imports.createApplication') !== -1, 'the action is not offered once approved');

      const res = Imports.createApplication(job.id);
      assert(res.ok === true, 'the application was not created: ' + res.error);

      /* it is an item on the existing Applications page, with the job preserved */
      const pkg = ApplicationPackages.forJob(job.id);
      assert(pkg, 'no application package on the Applications page');
      assert(pkg.job.title === GOOD.title && pkg.job.company === GOOD.company, 'the title/company were not preserved');
      assert(pkg.job.applyUrl === GOOD.url, 'the job URL was not preserved');
      assert(pkg.job.location === GOOD.location, 'the location was not preserved');
      assert(pkg.job.source === 'Imported', 'the source was not preserved');
      const m = ImportedJobs.match(job, JobMatchEngine.snapshotFromProfile(Profile.getState()));
      assert(pkg.matchScore === m.percentage, 'the match score was not preserved: ' + pkg.matchScore);
      assert(pkg.status === 'ready_to_apply', 'the application should start at Ready to Apply');
      assert(Applications.render().indexOf(GOOD.company) !== -1, 'the application is not on the Applications page');

      /* the Sprint 24 workflow runs on it, unchanged */
      Applications.setPackageStatus(pkg.id, 'applied');
      assert(ApplicationPackages.forJob(job.id).status === 'applied', 'the Sprint 24 status workflow broke');
      assert(Applications.counts().applied >= 1, 'the dashboard counters did not follow');
      return 'approved → application created on the Applications page with title, company, source, URL, location and match score';
    }],

    ['9 · Duplicate application prevention', () => {
      reset();
      const job = importGood().job;
      Imports.setStatus(job.id, 'approved');

      const first = Imports.createApplication(job.id);
      assert(first.ok, 'the first application failed');
      const pkgId = ApplicationPackages.forJob(job.id).id;

      /* a second attempt is refused, and nothing is duplicated */
      const second = Imports.createApplication(job.id);
      assert(second.ok === false, 'a second application was created for the same job');
      assert(/already exists/i.test(second.error), 'the duplicate message is unclear: ' + second.error);
      assert(ApplicationPackages.all().length === 1, 'a duplicate package exists: ' + ApplicationPackages.all().length);
      assert(ApplicationPackages.forJob(job.id).id === pkgId, 'the original application was replaced');

      /* the card says so instead of offering the action again */
      const html = Imports.render();
      assert(html.indexOf('Application created') !== -1, 'the card does not show that an application exists');
      assert(html.indexOf('Imports.createApplication') === -1, 'the action is still offered after an application exists');
      assert(ImportedJobs.hasApplication(job.id) === true, 'hasApplication is wrong');

      /* a different imported job still gets its own application */
      const other = importGood({ url: 'https://jobs.lever.co/beta/4', company: 'Beta' }).job;
      Imports.setStatus(other.id, 'approved');
      assert(Imports.createApplication(other.id).ok === true, 'a different job was blocked');
      assert(ApplicationPackages.all().length === 2, 'the second job did not get its own application');
      return 'one application per imported job · the card reflects it · other jobs unaffected';
    }],

    ['10 · Backward compatibility', () => {
      reset();
      const job = importGood().job;

      /* Sprint 25: the discovery engine and its board are untouched */
      assert(JobDiscoveryService.registered().length >= 4, 'the discovery providers were disturbed');
      assert(typeof JobMatchEngine.score === 'function', 'JobMatchEngine changed');
      assert(Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0) === 100,
        'the original MatchEngine changed');

      /* Today's Jobs still renders its own board, unchanged, with the import
         section added above it */
      const html = Jobs.render();
      ['job-card', 'MATCH', 'job-breakdown', 'job-resume', 'job-cover', 'job-search']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the Today’s Jobs UI changed — lost ' + k));
      assert(html.indexOf('imports') !== -1, 'the import section is not inside Today’s Jobs');
      assert(Jobs.evaluated().length > 0, 'the sourced board disappeared');

      /* an imported job never enters the sourced board or its decisions */
      assert(!JobsStore.jobs().some(j => j.id === job.id), 'an imported job leaked into the sourced board');
      assert(JobsStore.load().decisions[job.id] === undefined, 'an imported job created a board decision');

      /* Sprint 24: the applications workflow is intact */
      assert(ApplicationPackages.STATUSES.length === 5, 'the Sprint 24 statuses changed');
      assert(Applications.render().indexOf('kboard') !== -1, 'the Applications board disappeared');

      /* approving a SOURCED job still works exactly as before */
      const sourced = Jobs.evaluated()[0].job;
      Jobs.approve(sourced.id);
      assert(JobsStore.load().decisions[sourced.id] === 'approved', 'the sourced approval flow broke');
      assert(ApplicationPackages.forJob(sourced.id), 'a sourced job no longer produces a package');
      Jobs.undo(sourced.id);
      return 'Sprints 24–25 intact · Today’s Jobs board unchanged · imported jobs stay out of the sourced board';
    }],
  ];

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Profile.getState() hands back the LIVE in-memory profile. Pin it to the
     shipped defaults for the run (in place, never saved) so the assertions are
     deterministic no matter what the user has entered, then put it back. */
  function pinProfile() {
    const p = Profile.getState();
    const snap = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.demo();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snap);
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
        'careerpilot_platform.application_packages', 'careerpilot_platform.imported_jobs']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      Jobs.reload();
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
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 26: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
