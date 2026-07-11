/* ============================================================
   Sprint 12 test harness — Application Automation & Submission
   Readiness. Runs in the browser (no Node/CLI runtime in this
   project). Open app/tests/sprint12.html to execute.

   It exercises the REAL modules against localStorage. To keep the
   user's app data untouched, it snapshots ALL localStorage on
   entry and restores it verbatim in a finally block — the run is
   side-effect-free once finished.

   Covers PART 7:
     1  application package contains all required fields
     2  missing answers are flagged (and 13-question set complete)
     3  master resume remains byte-identical / unchanged
     4  approval is required before submission
     5  mock submission updates status correctly
     6  failed submission can retry (and never marks applied)
     7  existing application board still works
     8  existing connector pipeline + submitter interface intact
   ============================================================ */

(function () {

  /* ---- tiny assertion kit ---- */
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const REQUIRED_ANSWER_IDS = [
    'notice_period', 'salary_expectation', 'work_authorization', 'visa_sponsorship',
    'relocation', 'why_company', 'why_role', 'current_location',
    'visa_status', 'years_experience', 'current_employer', 'highest_qualification', 'certifications',
  ];

  function makeJob(id, source) {
    return JobSchema.normalized({
      id: id, source: source || 'Greenhouse', sourceJobId: id.toUpperCase(),
      title: 'Solutions Engineer', company: 'Acme Cloud',
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 120, salaryMax: 150, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year',
      visaSponsorship: true,
      description: 'Own technical delivery end to end for enterprise customers. Terraform, Kubernetes and Azure across client onboarding and production rollout.',
      skills: ['Terraform', 'Kubernetes', 'Azure', 'Python'],
      preferredSkills: ['SQL'],
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/' + id,
    });
  }

  function makeItem(id, source) {
    return {
      job: makeJob(id, source),
      res: { score: 88, matched: ['Terraform', 'Kubernetes', 'Azure'], missing: [] },
      decision: {
        outcome: 'auto_approve', recommendation: 'Strong Match', confidence: 'High',
        reasons: [{ ok: true, text: 'Verified skill overlap: Terraform, Kubernetes, Azure' }],
      },
    };
  }

  /* ---- the test cases ---- */
  const CASES = [

    ['1 · Application package contains every required field', () => {
      const item = makeItem('test-pkg-1');
      const pkg = Prep.buildFor(item);
      assert(pkg, 'buildFor returned no package');
      assert(pkg.status === 'ready_for_review', 'package should reach ready_for_review, got ' + pkg.status);
      // exact job record + company/role/source/url
      assert(JSON.stringify(pkg.job) === JSON.stringify(item.job), 'job record is not the exact record');
      assert(pkg.job.company === 'Acme Cloud', 'company missing');
      assert(pkg.job.title === 'Solutions Engineer', 'role missing');
      assert(pkg.job.source === 'Greenhouse', 'source missing');
      assert(pkg.sourceUrl === item.job.applyUrl, 'canonical apply URL missing/incorrect');
      // tailored resume version + safety score
      assert(pkg.resume && /v\d+/.test(pkg.resume.label), 'tailored resume version missing');
      assert(pkg.resume.safety && pkg.resume.safety.score === 100, 'resume safety score missing/!=100');
      // cover letter + answers + match + decision
      assert(typeof pkg.coverLetter === 'string' && pkg.coverLetter.length > 50, 'cover letter missing');
      assert(Array.isArray(pkg.answers) && pkg.answers.length === 13, 'answers should be 13, got ' + (pkg.answers || []).length);
      assert(pkg.matchScore === 88, 'match score missing');
      assert(pkg.decision && pkg.decision.reasons.length, 'decision explanation missing');
      // missing info + manual-review flags + date prepared
      assert(Array.isArray(pkg.missingInfo), 'missingInfo missing');
      assert(Array.isArray(pkg.flaggedAnswers), 'manual-review flags (flaggedAnswers) missing');
      assert(Array.isArray(pkg.blockers), 'blockers (manual review) missing');
      assert(typeof pkg.createdAt === 'number' && pkg.createdAt > 0, 'date prepared missing');
      return 'all 14 required package fields present · 13 answers · safety 100';
    }],

    ['2 · Missing answers are flagged (13-question set complete)', () => {
      const item = makeItem('test-ans-1');
      const answers = AnswersEngine.generate(item.job, Profile.getState(), item.res);
      assert(answers.length === 13, 'expected 13 answers, got ' + answers.length);
      REQUIRED_ANSWER_IDS.forEach(id => assert(answers.some(a => a.id === id), 'missing answer id: ' + id));
      // highest_qualification has no supporting profile field → must flag
      const hq = answers.find(a => a.id === 'highest_qualification');
      assert(hq.supported === false, 'highest_qualification should be unsupported');
      assert(hq.flag === 'Manual review required', 'flag text should be "Manual review required"');
      assert(hq.answer === '', 'flagged answer must be empty (never invented)');
      // every flagged answer is empty + carries the flag
      answers.filter(a => !a.supported).forEach(a => {
        assert(a.answer === '', 'unsupported answer must be empty: ' + a.id);
        assert(a.flag === 'Manual review required', 'unsupported answer must carry flag: ' + a.id);
      });
      const flaggedCount = answers.filter(a => !a.supported).length;
      return `13 questions present · ${flaggedCount} flagged for manual review, all empty`;
    }],

    ['3 · Master resume remains byte-identical / unchanged', () => {
      const before = localStorage.getItem(MasterResume.KEY);
      // full build + mock submit
      const item = makeItem('test-master-1');
      Prep.buildFor(item);
      Prep.markReady(item.job.id);
      SubmissionEngine.approveAndSubmit(item.job.id);
      const after = localStorage.getItem(MasterResume.KEY);
      assert(before === after, 'master resume storage changed during prepare/submit');
      // the submission snapshot must reference a COPY, never the master file
      const rec = SubmissionStore.get(item.job.id);
      assert(rec && /copied|copy/i.test(rec.snapshot.resume.base), 'snapshot resume is not marked a copy of the master');
      return 'master storage identical before/after · submission used a tailored copy';
    }],

    ['4 · Approval is required before submission', () => {
      const item = makeItem('test-approval-1');
      Prep.buildFor(item);   // status = ready_for_review, NOT ready_to_apply
      const r = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(r === null, 'submission proceeded without ready_to_apply');
      assert(SubmissionEngine.statusOf(item.job.id) === null, 'a submission record was created without approval');
      return 'submit refused until package is Ready to Apply (no record created)';
    }],

    ['5 · Mock submission updates status correctly', () => {
      const item = makeItem('test-submit-1');
      Prep.buildFor(item);
      assert(Prep.markReady(item.job.id) === true, 'markReady failed');
      const rec = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(rec && rec.status === 'submitted', 'status should be submitted, got ' + (rec && rec.status));
      assert(/^MOCK-/.test(rec.confirmationId), 'confirmation id missing');
      assert(rec.submittedAt > 0, 'submittedAt missing');
      // snapshot froze the exact resume + answers + cover letter
      assert(rec.snapshot && rec.snapshot.answers.length === 13, 'snapshot answers not frozen');
      assert(typeof rec.snapshot.coverLetter === 'string' && rec.snapshot.coverLetter.length > 50, 'snapshot cover letter not frozen');
      assert(SubmissionStore.get(item.job.id).status === 'submitted', 'persisted status wrong');
      // status trail records the transition through submission_started
      assert(rec.statusTrail.some(s => s.status === 'submission_started'), 'no submission_started transition recorded');
      return 'submission_started → submitted · confirmation ' + rec.confirmationId;
    }],

    ['6 · Failed submission can retry (never marks applied)', () => {
      const item = makeItem('test-fail-1');
      Prep.buildFor(item);
      Prep.markReady(item.job.id);
      const failRec = SubmissionEngine.approveAndSubmit(item.job.id, { simulate: 'fail' });
      assert(failRec.status === 'retry_required', 'failed submit should be retry_required, got ' + failRec.status);
      assert(failRec.status !== 'submitted', 'FAILED submission must never be marked submitted/applied');
      assert(failRec.confirmationId === null, 'failed submission must have no confirmation id');
      const lastAttempt = failRec.attempts[failRec.attempts.length - 1];
      assert(lastAttempt.state === 'submission_failed', 'attempt state should be submission_failed');
      assert(!!failRec.lastError, 'failure error not recorded');
      // retry succeeds
      const retryRec = SubmissionEngine.retry(item.job.id);
      assert(retryRec.status === 'submitted', 'retry should succeed, got ' + retryRec.status);
      assert(retryRec.attemptCount >= 2, 'retry should record a second attempt');
      return 'fail → retry_required (not applied) → retry → submitted · ' + retryRec.attemptCount + ' attempts';
    }],

    ['7 · Existing application board still works', () => {
      const apps = ApplicationsStore.load();
      assert(Array.isArray(apps) && apps.length > 0, 'application board did not load');
      apps.forEach(a => assert(ApplicationsStore.isKnownStatus(a.status), 'unknown status on board: ' + a.status));
      assert(ApplicationsStore.columnFor('applied') === 'applied', 'columnFor(applied) broken');
      assert(ApplicationsStore.columnFor('ready_to_apply') === null, 'pre-application state should not be on the board');
      // a successful mock submission must NOT auto-write the board
      const before = JSON.stringify(ApplicationsStore.load());
      const item = makeItem('test-board-1');
      Prep.buildFor(item); Prep.markReady(item.job.id); SubmissionEngine.approveAndSubmit(item.job.id);
      assert(JSON.stringify(ApplicationsStore.load()) === before, 'submission mutated the application board');
      return apps.length + ' applications load · lifecycle mapping intact · board untouched by submit';
    }],

    ['8 · Connector pipeline + submitter interface intact', () => {
      // connector framework (Sprint 9-11) still whole
      assert(typeof ConnectorManager !== 'undefined', 'ConnectorManager missing');
      assert(Connectors.all().length === 8, 'expected 8 connectors, got ' + Connectors.all().length);
      Connectors.all().forEach(a => {
        ['searchJobs', 'healthCheck', 'authenticate', 'shutdown'].forEach(m => assert(typeof a[m] === 'function', a.id + ' missing ' + m));
      });
      const batches = ConnectorManager.collect();
      assert(Array.isArray(batches), 'ConnectorManager.collect did not return an array');
      batches.forEach(b => assert('id' in b && 'state' in b && Array.isArray(b.jobs), 'malformed batch from connector pipeline'));
      // submission adapter interface (Sprint 12 PART 5): 8 mock submitters, 9 methods each
      const METHODS = ['prepare', 'validate', 'uploadResume', 'uploadCoverLetter', 'fillAnswers', 'review', 'submit', 'getStatus', 'retry'];
      const EXPECTED = ['linkedin', 'bayt', 'gulftalent', 'greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers'];
      EXPECTED.forEach(id => {
        const s = Submitters.get(id);
        assert(s, 'missing submitter: ' + id);
        METHODS.forEach(m => assert(typeof s[m] === 'function', id + ' submitter missing method ' + m));
      });
      // resolve a submitter from a job by source
      assert(Submitters.forJob(makeJob('x', 'LinkedIn')).id === 'linkedin', 'forJob did not resolve LinkedIn');
      assert(Submitters.forJob(makeJob('x', 'Company Careers')).id === 'careers', 'forJob fallback wrong');
      return '8 connectors + ' + batches.length + ' batches · 8 submitters × 9 methods verified';
    }],
  ];

  /* ---- runner (snapshot → run → restore) ---- */
  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      // deterministic slate (restored afterwards)
      ['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_profile_v1'].forEach(k => localStorage.removeItem(k));
      CASES.forEach(([name, fn]) => {
        try { results.push({ name, pass: true, detail: fn() || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      });
    } finally {
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
    }
    return results;
  }

  function render(results) {
    const passed = results.filter(r => r.pass).length;
    const el = document.getElementById('results');
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    el.innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${r.name}</b><div class="detail">${r.detail}</div></div>
      </div>`).join('');
    /* also emit to console for CI-style capture */
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 12: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
