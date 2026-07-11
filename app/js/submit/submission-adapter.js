/* ============================================================
   SubmissionBase — the application-SUBMISSION adapter interface
   (Sprint 12).

   This is the production seam for actually applying to a job.
   Every destination (LinkedIn Easy Apply, Bayt, GulfTalent,
   Greenhouse, Lever, Workday, SmartRecruiters, generic company
   careers) is a submitter with this exact shape:

     { id, label, method,
       capabilities: { resume, coverLetter, answers },
       requires:  string[],

       prepare(pkg)            → { ok, step, payload, note }
       validate(pkg)           → { ok, problems[], warnings[] }
       uploadResume(payload)   → { ok, step, artifact, ref, note }
       uploadCoverLetter(p)    → { ok, step, artifact, ref, note }
       fillAnswers(payload)    → { ok, step, filled, skipped[] }
       review(payload)         → { ok, step, summary }
       submit(payload, opts)   → { ok, step, state, confirmationId | error }
       getStatus(payload)      → { ok, state, confirmationId? }
       retry(payload, opts)    → submit() again
     }

   DELIBERATELY NOT IMPLEMENTED IN THIS BUILD:
     • login / session automation — no credentials ever touch the
       browser (see ConnectorConfig's reference-only rule)
     • live network submission — submit() is a MOCK that returns a
       confirmation id (or a simulated failure to exercise retry)

   SAFETY (Sprint 12 PART 6): uploadResume() uploads the TAILORED
   COPY described by the package's plan — it never reads, mutates
   or uploads the locked master file. validate() blocks any
   package whose resume safety is below 100 or that still carries
   generation blockers, so unsupported claims can never be sent.
   ============================================================ */

const SubmissionBase = (() => {

  /* adapter-level states (mirror SubmissionStore's submit phase) */
  const STATES = {
    STARTED:   'submission_started',
    SUBMITTED: 'submitted',
    FAILED:    'submission_failed',
    UNKNOWN:   'unknown',
  };

  const lc = s => String(s || '').toLowerCase();

  /* ---- shared, provider-agnostic implementations ---- */

  /* prepare(): assemble the immutable submission payload from the
     prepared package. Pulls the tailored-copy descriptor, cover
     letter and the full answer set — never the master file. */
  function prepare(spec, pkg) {
    if (!pkg || !pkg.job) return { ok: false, step: 'prepare', error: 'No prepared package to submit' };
    const r = pkg.resume || {};
    const payload = {
      jobId: pkg.jobId,
      jobTitle: pkg.job.title,
      company: pkg.job.company,
      role: pkg.job.title,
      source: pkg.job.source,
      sourceUrl: pkg.sourceUrl || pkg.job.applyUrl || '',
      submitterId: spec.id,
      method: spec.method,
      resume: {
        label: r.label || 'Tailored copy',
        base: r.base || 'Locked master resume (copied, never modified)',
        safety: r.safety ? r.safety.score : null,
        changes: r.plan ? (r.plan.changes || []).length : 0,
        matched: (r.matched || []).slice(),
      },
      coverLetter: pkg.coverLetter || '',
      answers: (pkg.answers || []).map(a => ({
        id: a.id, question: a.question, answer: a.answer,
        supported: a.supported, flag: a.flag || null,
      })),
      confirmationId: null,
    };
    return { ok: true, step: 'prepare', payload, note: `Assembled ${spec.label} submission payload (mock)` };
  }

  /* validate(): the safety gate. HARD problems block submission;
     WARNINGS are surfaced for the human to acknowledge but never
     block (an empty answer is a gap to fill on the ATS, not a
     false claim). */
  function validate(spec, pkg) {
    const problems = [];
    const warnings = [];
    if (!pkg || !pkg.job) return { ok: false, step: 'validate', problems: ['No prepared package'], warnings };

    const r = pkg.resume || {};
    const safety = r.safety ? r.safety.score : 0;
    if (safety < 100) problems.push(`Resume safety is ${safety}/100 — unverifiable content must be resolved before submission.`);
    if (r.interviewCheck && r.interviewCheck.pass === false) problems.push('Resume interview-safety check failed — content without provenance detected.');
    (pkg.blockers || []).forEach(b => problems.push(b));
    if (!(pkg.sourceUrl || (pkg.job && pkg.job.applyUrl))) problems.push('No canonical apply URL on the package.');
    if (pkg.status !== 'ready_to_apply') problems.push('Package is not marked Ready to Apply — explicit review is required first.');

    /* capability check — a board that cannot accept a cover letter
       simply skips it (warning), it is never a hard failure */
    if (!spec.capabilities.coverLetter && pkg.coverLetter) {
      warnings.push(`${spec.label} does not accept a cover letter — it will be omitted.`);
    }

    /* unresolved manual-review answers → acknowledge, don't block */
    const flagged = (pkg.answers || []).filter(a => !a.supported);
    if (flagged.length) {
      warnings.push(`${flagged.length} answer${flagged.length > 1 ? 's' : ''} still need manual completion: ${flagged.map(a => a.question).join(' · ')}`);
    }
    (pkg.missingInfo || []).forEach(m => warnings.push(`Posting requests ${lc(m.item)} — not available from your profile/master resume.`));

    return { ok: problems.length === 0, step: 'validate', problems, warnings };
  }

  function uploadResume(spec, payload) {
    if (!spec.capabilities.resume) return { ok: true, step: 'uploadResume', artifact: 'resume', ref: null, note: `${spec.label} takes the resume from your profile — no upload step.` };
    return {
      ok: true, step: 'uploadResume', artifact: 'resume',
      ref: `mock://${spec.id}/resume/${payload.jobId}`,
      note: 'Uploaded the tailored COPY — the locked master file is never read or sent (mock).',
    };
  }

  function uploadCoverLetter(spec, payload) {
    if (!spec.capabilities.coverLetter) return { ok: true, step: 'uploadCoverLetter', artifact: 'coverLetter', ref: null, note: `${spec.label} has no cover-letter field — skipped.` };
    if (!payload.coverLetter) return { ok: true, step: 'uploadCoverLetter', artifact: 'coverLetter', ref: null, note: 'No cover letter on the package — skipped.' };
    return {
      ok: true, step: 'uploadCoverLetter', artifact: 'coverLetter',
      ref: `mock://${spec.id}/cover/${payload.jobId}`,
      note: 'Attached the drafted cover letter (mock).',
    };
  }

  function fillAnswers(spec, payload) {
    if (!spec.capabilities.answers) return { ok: true, step: 'fillAnswers', filled: 0, skipped: [], note: `${spec.label} asks no screening questions.` };
    const supported = (payload.answers || []).filter(a => a.supported);
    const skipped = (payload.answers || []).filter(a => !a.supported).map(a => a.question);
    return {
      ok: true, step: 'fillAnswers', filled: supported.length, skipped,
      note: `Filled ${supported.length} supported answer${supported.length === 1 ? '' : 's'}${skipped.length ? `, left ${skipped.length} for manual completion` : ''} (mock).`,
    };
  }

  function review(spec, payload) {
    return {
      ok: true, step: 'review',
      summary: {
        board: spec.label, method: spec.method,
        role: payload.role, company: payload.company,
        resume: payload.resume.label, safety: payload.resume.safety,
        answers: (payload.answers || []).length,
        supportedAnswers: (payload.answers || []).filter(a => a.supported).length,
        sourceUrl: payload.sourceUrl,
      },
    };
  }

  /* submit(): the MOCK. No network, no login. Returns a confirmation
     id on success, or a simulated failure when opts.simulate==='fail'
     (or the submitter is configured to fail) so the retry path is
     exercisable end-to-end. */
  function submit(spec, payload, opts = {}) {
    const forceFail = opts.simulate === 'fail' || spec._simulate === 'fail';
    if (forceFail) {
      return {
        ok: false, step: 'submit', state: STATES.FAILED,
        error: 'Mock submission failure (simulated) — the destination returned a transient error. Retry available.',
      };
    }
    return {
      ok: true, step: 'submit', state: STATES.SUBMITTED,
      confirmationId: `MOCK-${String(spec.id).toUpperCase()}-${payload.jobId}-${Date.now().toString(36)}`,
    };
  }

  function getStatus(spec, payload) {
    if (payload && payload.confirmationId) return { ok: true, state: STATES.SUBMITTED, confirmationId: payload.confirmationId };
    return { ok: true, state: STATES.UNKNOWN };
  }

  function retry(spec, payload, opts = {}) {
    return submit(spec, payload, opts);
  }

  /* ---- the factory ---- */

  function createSubmitter(spec) {
    const s = {
      id: spec.id,
      label: spec.label,
      method: spec.method || 'ats_form',
      capabilities: Object.assign({ resume: true, coverLetter: true, answers: true }, spec.capabilities || {}),
      requires: spec.requires || [],
      _simulate: spec.simulate || 'none',
    };
    return Object.assign(s, {
      prepare: pkg => prepare(s, pkg),
      validate: pkg => validate(s, pkg),
      uploadResume: payload => uploadResume(s, payload),
      uploadCoverLetter: payload => uploadCoverLetter(s, payload),
      fillAnswers: payload => fillAnswers(s, payload),
      review: payload => review(s, payload),
      submit: (payload, opts) => submit(s, payload, opts),
      getStatus: payload => getStatus(s, payload),
      retry: (payload, opts) => retry(s, payload, opts),
    });
  }

  return { STATES, createSubmitter };
})();
