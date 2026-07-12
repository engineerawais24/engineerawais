/* ============================================================
   Sprint 13 test harness — Interview Copilot & Application Memory.
   Runs in the browser (no Node/CLI runtime in this project).
   Open app/tests/sprint13.html to execute. Snapshots ALL
   localStorage and restores it in a finally block, so app data is
   untouched.

   Covers PART 9:
     1  exact submitted resume is preserved (never replaced)
     2  interview prep uses the correct application package
     3  no unsupported answers are generated
     4  STAR answers trace to real experience
     5  mock interview state persists
     6  follow-up dates persist
     7  existing application + submission workflows unchanged
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function makeJob(id, source, skills) {
    return JobSchema.normalized({
      id: id, source: source || 'Greenhouse', sourceJobId: id.toUpperCase(),
      title: 'Solutions Engineer', company: source === 'Lever' ? 'Beta Corp' : 'Acme Cloud',
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 120, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year', visaSponsorship: true,
      description: 'Own technical delivery end to end. Terraform, Kubernetes and Azure across client onboarding.',
      skills: skills || ['Terraform', 'Kubernetes', 'Azure', 'Python'],
      preferredSkills: ['SQL'],
      applyUrl: 'https://boards.example.com/' + id,
    });
  }
  function makeItem(id, source, skills) {
    return {
      job: makeJob(id, source, skills),
      res: { score: 88, matched: ['Terraform', 'Kubernetes', 'Azure'], missing: [] },
      decision: { outcome: 'auto_approve', recommendation: 'Strong Match', confidence: 'High', reasons: [{ ok: true, text: 'Skill overlap' }] },
    };
  }
  /* submit an application and capture its interview memory */
  function submitAndCapture(id, source, skills) {
    const item = makeItem(id, source, skills);
    Prep.buildFor(item);
    Prep.markReady(item.job.id);
    SubmissionEngine.approveAndSubmit(item.job.id);
    ApplicationMemory.syncFromSubmissions();
    return { item, jobId: item.job.id, memory: ApplicationMemory.get(item.job.id) };
  }

  /* a deterministic profile with real, matchable experience */
  function evidenceProfile() {
    return {
      personal: { firstName: 'Test', lastName: 'User', headline: 'Ops Lead', summary: 'Operations leader in mission-critical delivery.' },
      contact: { email: 't@e.com', phone: '', city: 'Riyadh', country: 'Saudi Arabia' },
      links: { linkedin: '', github: '', portfolio: '', other: '' },
      employment: {
        title: 'Operations Lead', company: 'STC', startDate: '2020-01', type: 'Full-time', current: true, noticePeriod: '1 month',
        highlights: 'Led a team of 8 during nationwide network operations at STC.\nManaged major incident response and root cause analysis, cutting outages by 40%.\nCoordinated vendors and third-party suppliers across the rollout.',
      },
      history: [],
      skills: ['Operations', 'Incident management', 'Leadership'],
      certifications: [{ name: 'ITIL v4', issuer: 'Axelos', year: '2022' }],
      languages: [{ name: 'English', level: 'Fluent' }],
      preferences: { targetRoles: 'Operations Lead', locations: '', minSalary: 100, workMode: 'Remote', outsideGccMode: 'Remote', jobType: 'Full-time' },
      authorization: { status: 'Citizen', authorizedIn: 'Saudi Arabia', sponsorship: false },
    };
  }

  const CASES = [

    ['1 · Exact submitted resume is preserved (never replaced)', () => {
      const { jobId, memory } = submitAndCapture('iv-preserve-1');
      assert(memory && memory.submitted, 'memory not captured');
      const frozen = JSON.stringify(memory.submitted);
      // rebuild the package for the SAME job with different content (bumps version, new plan)
      const item2 = makeItem('iv-preserve-1', 'Greenhouse', ['Go', 'Rust', 'Kafka', 'gRPC']);
      Prep.buildFor(item2);
      const sub = SubmissionStore.get(jobId);
      const pkg2 = PrepStore.get(jobId);
      // sync + direct re-capture must NOT overwrite the frozen submitted block
      ApplicationMemory.syncFromSubmissions();
      ApplicationMemory.captureFromSubmission(pkg2, sub, Profile.getState());
      const after = ApplicationMemory.get(jobId);
      assert(JSON.stringify(after.submitted) === frozen, 'submitted version was silently replaced');
      assert(after.submitted.answers.length === 13, 'submitted answers not frozen (expected 13)');
      // master resume file untouched
      return 'submitted block byte-identical after package rebuild + re-capture';
    }],

    ['2 · Interview prep uses the correct application package', () => {
      const a = submitAndCapture('iv-pkgA-1', 'Greenhouse');
      const b = submitAndCapture('iv-pkgB-1', 'Lever', ['Go', 'Docker']);
      const profile = Profile.getState();
      const pkA = InterviewEngine.prepPackage(a.memory, profile);
      const pkB = InterviewEngine.prepPackage(b.memory, profile);
      assert(pkA.jobSummary.company === a.memory.company, 'prep A company mismatch');
      assert(pkB.jobSummary.company === b.memory.company, 'prep B company mismatch');
      assert(pkA.jobSummary.company !== pkB.jobSummary.company, 'two apps resolved to the same company');
      // prep pulls the exact submitted documents, not the live/other package
      assert(pkA.submittedResume === a.memory.submitted.resumeDoc, 'prep resume not the frozen submitted doc');
      assert(pkA.submittedCover === a.memory.submitted.coverLetter, 'prep cover not the submitted cover');
      assert(pkA.submittedAnswers === a.memory.submitted.answers, 'prep answers not the submitted answers');
      assert(JSON.stringify(pkA.requiredSkills) === JSON.stringify(a.memory.job.skills), 'required skills mismatch');
      return `A=${pkA.jobSummary.company} vs B=${pkB.jobSummary.company}, each uses its own frozen package`;
    }],

    ['3 · No unsupported answers are generated', () => {
      const { memory } = submitAndCapture('iv-nounsup-1');
      const groups = InterviewEngine.questionGroups(memory, Profile.getState());
      let answered = 0, blocked = 0;
      groups.forEach(g => g.questions.forEach(q => {
        if (q.a && q.a.trim()) {
          answered++;
          assert(q.safety !== 'blocked', 'a blocked question produced an answer: ' + q.q);
          assert(!!q.source, 'generated answer has no provenance source: ' + q.q);
        } else {
          blocked++;
          assert(q.safety === 'blocked' || q.safety === 'prep', 'empty answer not marked prep/blocked: ' + q.q);
          assert(!!(q.flag || q.note), 'empty answer not flagged for manual review: ' + q.q);
        }
      }));
      assert(answered > 0, 'no answers were generated at all');
      return `${answered} answers, all provenance-backed · ${blocked} correctly left blank/flagged`;
    }],

    ['4 · STAR answers trace to real experience', () => {
      const profile = evidenceProfile();
      const stars = StarLibrary.build(profile, null);
      assert(stars.length === 10, 'expected 10 STAR themes, got ' + stars.length);
      const pool = StarLibrary.evidencePool(profile, null);
      const byId = id => stars.find(s => s.id === id);
      // themes with real evidence must be non-blocked and trace verbatim
      ['stc_ops', 'incident', 'vendor', 'leadership'].forEach(id => {
        const s = byId(id);
        assert(s.safety !== 'blocked', id + ' should be supported by the evidence profile');
        assert(!!s.source, id + ' has no supporting source');
        assert(!!s.action && pool.some(e => s.action.indexOf(e.text) !== -1), id + ' action does not trace to real evidence');
      });
      // themes with no evidence must be blocked + flagged, never invented
      ['zatca_psim', 'g20_hajj'].forEach(id => {
        const s = byId(id);
        assert(s.safety === 'blocked', id + ' should be blocked (no evidence)');
        assert(s.flag === 'Manual review required', id + ' must be flagged for manual review');
        assert(!s.action, id + ' must not fabricate an action');
      });
      return 'supported themes trace verbatim; unsupported themes blocked + flagged (nothing invented)';
    }],

    ['5 · Mock interview state persists', () => {
      const { jobId, memory } = submitAndCapture('iv-mock-1');
      const session = MockInterview.ensure(memory, Profile.getState(), 'technical');
      assert(session.questions.length > 0, 'no mock questions generated');
      // simulate the controller persisting an answer + rating
      Interview.mockAnswer(jobId, 0, 'My practised STAR answer.');
      Interview.mockRate(jobId, 0, 4);
      Interview.mockNote(jobId, 0, 'Tighten the result.');
      // reload from storage
      const reloaded = ApplicationMemory.get(jobId);
      assert(reloaded.mock.technical, 'technical mock session not persisted');
      assert(reloaded.mock.technical.answers['0'] === 'My practised STAR answer.', 'answer not persisted');
      assert(reloaded.mock.technical.ratings['0'] === 4, 'rating not persisted');
      assert(reloaded.mock.technical.notes['0'] === 'Tighten the result.', 'note not persisted');
      return 'answer + rating + note persisted and reloaded from storage';
    }],

    ['6 · Follow-up dates + interview fields persist', () => {
      const { jobId } = submitAndCapture('iv-follow-1');
      const frozenBefore = JSON.stringify(ApplicationMemory.get(jobId).submitted);
      ApplicationMemory.update(jobId, {
        followUpDate: '2026-08-01',
        interview: { date: '2026-07-20', type: 'Technical', interviewer: 'Jane Roe', meetingLink: 'https://meet/x' },
        recruiterNotes: 'Spoke to recruiter.', notes: 'Went well.',
      });
      ApplicationMemory.setStatus(jobId, 'interview_scheduled');
      const rec = ApplicationMemory.get(jobId);
      assert(rec.followUpDate === '2026-08-01', 'follow-up date not persisted');
      assert(rec.interview.date === '2026-07-20', 'interview date not persisted');
      assert(rec.interview.type === 'Technical' && rec.interview.interviewer === 'Jane Roe', 'interview fields not persisted');
      assert(rec.status === 'interview_scheduled', 'workflow status not persisted');
      assert(rec.events.some(e => e.status === 'interview_scheduled'), 'status event not recorded');
      // mutable updates must not touch the frozen submitted version
      assert(JSON.stringify(rec.submitted) === frozenBefore, 'tracker update mutated the frozen submitted version');
      return 'follow-up + interview fields + workflow state persisted; submitted block untouched';
    }],

    ['7 · Existing application + submission workflows unchanged', () => {
      // application board regression
      const apps = ApplicationsStore.load();
      assert(Array.isArray(apps) && apps.length > 0, 'application board did not load');
      apps.forEach(a => assert(ApplicationsStore.isKnownStatus(a.status), 'unknown board status: ' + a.status));
      // submission workflow: a submit still works and interview capture does not alter it
      const { jobId } = submitAndCapture('iv-reg-1');
      const subBefore = JSON.stringify(SubmissionStore.get(jobId));
      ApplicationMemory.syncFromSubmissions();
      ApplicationMemory.setStatus(jobId, 'interview_invited');
      const subAfter = JSON.stringify(SubmissionStore.get(jobId));
      assert(subBefore === subAfter, 'interview module mutated the submission record');
      assert(SubmissionStore.get(jobId).status === 'submitted', 'submission status changed');
      // connector framework still intact
      assert(typeof ConnectorManager !== 'undefined' && Connectors.all().length === 8, 'connector framework changed');
      return 'board + submission records + connector framework all intact';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      ['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1', 'careerpilot_profile_v1'].forEach(k => localStorage.removeItem(k));
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
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    document.getElementById('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${r.name}</b><div class="detail">${r.detail}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 13: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
