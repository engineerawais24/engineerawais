/* ============================================================
   SubmissionEngine — the submission execution layer (Sprint 12).

   The ONE thing that submits an application. The UI never calls a
   submitter directly; everything flows through here so the browser
   stays ignorant of whether submission is a mock today or a live
   backend tomorrow (the same contract ConnectorManager gives the
   discovery side).

   THE LIFECYCLE (all mock, no login, no live network):
     approveAndSubmit(jobId) — the ONLY entry, and it is gated:
       • the package must be ready_to_apply (the user's explicit
         review sign-off from Sprint 10C), and
       • the caller must be an explicit human action (the review
         screen guards it with a confirm() dialog)
     then per attempt:
       prepare → validate → snapshot → submission_started →
       uploadResume → uploadCoverLetter → fillAnswers → review →
       submit → submitted | retry_required

   SAFETY GUARANTEES (Sprint 12 PART 6):
     • the snapshot freezes the EXACT resume + answers + cover
       letter used, so every application is provable after the fact
     • validate() blocks any package whose resume safety < 100 or
       that still carries blockers — no unsupported claim is sent
     • a FAILED submission is recorded as retry_required, NEVER as
       submitted, and the Applications board is never auto-marked
       "applied" (promotion stays a manual user action)
     • the locked master resume is never read, copied or uploaded
   ============================================================ */

const SubmissionEngine = (() => {

  /* ---- small host-integration helpers (all optional) ---- */
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t); }
  function logActivity(level, m) { if (typeof Activity !== 'undefined') Activity.log(level, m); }
  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function'
        && ['review', 'approvals'].includes(currentRoute())) navigate();
  }

  function submitterFor(job) { return Submitters.forJob(job); }

  function record(jobId) { return SubmissionStore.get(jobId); }
  function statusOf(jobId) { const r = SubmissionStore.get(jobId); return r ? r.status : null; }
  function all() { return SubmissionStore.all(); }

  function newRecord(pkg, submitter) {
    return {
      id: 'sub-' + pkg.jobId, jobId: pkg.jobId,
      status: null, createdAt: Date.now(), updatedAt: Date.now(),
      submitter: { id: submitter.id, label: submitter.label, method: submitter.method },
      approvedByUser: null,
      snapshot: null,
      statusTrail: [],
      attempts: [], attemptCount: 0, lastError: null,
      confirmationId: null, submittedAt: null,
      lastValidation: null,
    };
  }

  /* the immutable proof of what was submitted */
  function snapshotOf(pkg, submitter, payload) {
    return {
      preparedAt: Date.now(),
      packageVersion: pkg.v || 1,
      submitter: { id: submitter.id, label: submitter.label, method: submitter.method },
      jobTitle: pkg.job.title, company: pkg.job.company, source: pkg.job.source,
      sourceUrl: payload.sourceUrl,
      resume: JSON.parse(JSON.stringify(payload.resume)),
      resumeSafety: payload.resume.safety,
      coverLetter: payload.coverLetter,
      answers: JSON.parse(JSON.stringify(payload.answers)),
    };
  }

  function setStatus(rec, status) {
    rec.status = status;
    rec.statusTrail.push({ status, at: Date.now() });
    SubmissionStore.put(rec);
  }

  /* diagnostics/preflight for the review screen */
  function preflight(jobId) {
    const pkg = PrepStore.get(jobId);
    if (!pkg) return null;
    const submitter = submitterFor(pkg.job);
    return {
      submitter: { id: submitter.id, label: submitter.label, method: submitter.method },
      validation: submitter.validate(pkg),
    };
  }

  /* run ONE submission attempt through the full lifecycle */
  function run(pkg, opts = {}) {
    const submitter = submitterFor(pkg.job);
    const rec = SubmissionStore.get(pkg.jobId) || newRecord(pkg, submitter);
    rec.submitter = { id: submitter.id, label: submitter.label, method: submitter.method };
    rec.approvedByUser = Date.now();       // this run is an explicit human action

    /* 1 — prepare the immutable payload */
    const prep = submitter.prepare(pkg);
    if (!prep.ok) {
      rec.lastError = prep.error || 'Preparation failed';
      setStatus(rec, 'retry_required');
      toastMsg(rec.lastError, 'error');
      refresh();
      return rec;
    }
    const payload = prep.payload;

    /* 2 — validate: HARD problems block the attempt (never submits) */
    const val = submitter.validate(pkg);
    rec.lastValidation = val;
    if (!val.ok) {
      rec.attempts.push({
        at: Date.now(), ok: false, state: 'submission_failed',
        error: 'Validation blocked: ' + val.problems.join(' '),
        confirmationId: null, steps: [{ step: 'validate', ok: false, note: val.problems.join(' ') }],
      });
      rec.attemptCount = rec.attempts.length;
      rec.lastError = val.problems.join(' ');
      setStatus(rec, 'retry_required');
      toastMsg('Cannot submit — ' + val.problems[0], 'error');
      refresh();
      return rec;
    }

    /* 3 — freeze exactly what is being submitted */
    if (opts.freshSnapshot || !rec.snapshot) rec.snapshot = snapshotOf(pkg, submitter, payload);

    /* 4 — submission_started */
    setStatus(rec, 'submission_started');

    /* 5–8 — upload resume (tailored copy), cover letter, answers, review */
    const steps = [];
    const collect = r => { steps.push({ step: r.step, ok: r.ok, note: r.note || '' }); return r; };
    collect(submitter.uploadResume(payload));
    collect(submitter.uploadCoverLetter(payload));
    const filled = collect(submitter.fillAnswers(payload));
    const rev = submitter.review(payload);
    steps.push({ step: 'review', ok: rev.ok, note: `Final review: ${rev.summary.supportedAnswers}/${rev.summary.answers} answers, safety ${rev.summary.safety}` });

    /* 9 — submit (MOCK) */
    const res = submitter.submit(payload, opts);
    const attempt = {
      at: Date.now(), ok: res.ok, state: res.state,
      error: res.ok ? null : res.error,
      confirmationId: res.ok ? res.confirmationId : null,
      filled: filled.filled, skipped: filled.skipped,
      steps,
    };
    rec.attempts.push(attempt);
    rec.attemptCount = rec.attempts.length;

    if (res.ok) {
      payload.confirmationId = res.confirmationId;
      rec.confirmationId = res.confirmationId;
      rec.submittedAt = Date.now();
      rec.lastError = null;
      setStatus(rec, 'submitted');
      logActivity('info', `Submitted “${pkg.job.title}” @ ${pkg.job.company} via ${submitter.label} (mock) — ${res.confirmationId}`);
      toastMsg(`${submitter.label}: application submitted (mock) — ${res.confirmationId}`, 'success');
    } else {
      /* FAILED → retry_required, never submitted/applied */
      rec.lastError = res.error;
      setStatus(rec, 'retry_required');
      logActivity('warn', `Submission FAILED for “${pkg.job.title}” @ ${pkg.job.company} (${submitter.label}): ${res.error}`);
      toastMsg(`${submitter.label}: submission failed — retry available`, 'error');
    }
    refresh();
    return rec;
  }

  /* the ONLY submission entry — gated on ready_to_apply + explicit
     human approval (the review screen wraps this in a confirm()). */
  function approveAndSubmit(jobId, opts = {}) {
    const pkg = PrepStore.get(jobId);
    if (!pkg) { toastMsg('No prepared package to submit', 'error'); return null; }
    if (pkg.status !== 'ready_to_apply') {
      toastMsg('Mark the package “Ready to Apply” before submitting', 'error');
      return null;
    }
    const existing = SubmissionStore.get(jobId);
    if (existing && existing.status === 'submitted') {
      toastMsg('Already submitted — nothing to resend', 'info');
      return existing;
    }
    return run(pkg, Object.assign({ freshSnapshot: true }, opts));
  }

  /* explicit recovery — re-sends the SAME frozen package. Reuses
     the stored snapshot so the retry submits exactly what was
     prepared. Also an explicit human action (the button confirms). */
  function retry(jobId, opts = {}) {
    const pkg = PrepStore.get(jobId);
    const rec = SubmissionStore.get(jobId);
    if (!pkg || !rec) { toastMsg('Nothing to retry', 'error'); return null; }
    if (rec.status === 'submitted') { toastMsg('Already submitted', 'info'); return rec; }
    setStatus(rec, 'retry_required');
    return run(pkg, opts);
  }

  return {
    approveAndSubmit, retry, preflight, submitterFor,
    record, statusOf, all,
    /* exposed for tests */
    run, snapshotOf,
  };
})();
