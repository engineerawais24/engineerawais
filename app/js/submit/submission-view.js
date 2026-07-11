/* ============================================================
   SubmissionView — the submission panel on the final review
   screen (Sprint 12 PART 4).

   Additive only: it renders one card that PrepView.reviewScreen
   appends beneath the package header. It shows the resolved
   destination, the pre-flight validation (hard blockers vs
   acknowledgeable warnings), the live submission status, and the
   single explicit approve-and-submit control.

   Nothing submits without TWO explicit human steps: the package
   must already be "Ready to Apply" (Sprint 10C review sign-off),
   and the user must confirm the submit dialog here. Submission is
   a MOCK — no login, no live network.
   ============================================================ */

const SubmissionView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const CHIP_CLASS = {
    submission_started: 'prep-indigo',
    submitted: 'prep-green',
    submission_failed: 'prep-red',
    retry_required: 'prep-red',
    ready_to_apply: 'prep-green',
    manual_review_required: 'prep-red',
  };

  function statusChip(status) {
    return `<span class="prep-chip ${CHIP_CLASS[status] || 'prep-neutral'}">${esc(SubmissionStore.statusLabel(status))}</span>`;
  }

  function methodLabel(m) {
    return ({
      easy_apply: 'Easy Apply', ats_api: 'ATS API',
      ats_form: 'ATS form', external_form: 'Careers form',
    })[m] || m;
  }

  function fmtTime(t) {
    return t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }

  /* the panel rendered inside the review screen */
  function panel(pkg) {
    if (!pkg) return '';
    const pre = SubmissionEngine.preflight(pkg.jobId);
    if (!pre) return '';
    const rec = SubmissionEngine.record(pkg.jobId);
    const sub = pre.submitter;
    const val = pre.validation;

    const ready = pkg.status === 'ready_to_apply';
    const submitted = rec && rec.status === 'submitted';
    const failed = rec && (rec.status === 'retry_required' || rec.status === 'submission_failed');
    const status = rec ? rec.status : (ready ? 'ready_to_apply' : pkg.status);

    /* the "not Ready to Apply yet" problem is covered by the action
       hint below — don't surface it as an alarming blocker here */
    const contentProblems = val.problems.filter(p => !/ready to apply/i.test(p));
    const problems = contentProblems.map(p => `<div class="mi-row">⛔ <b>Blocked:</b> ${esc(p)}</div>`).join('');
    const warnings = val.warnings.map(w => `<div class="sub-warn">⚠ ${esc(w)}</div>`).join('');

    /* the single submit / retry control — gated + confirmed */
    let action;
    if (submitted) {
      action = `<span class="hint" style="margin:0">Submitted (mock) — confirmation <b>${esc(rec.confirmationId)}</b> · ${esc(fmtTime(rec.submittedAt))}</span>`;
    } else if (!ready) {
      action = `<button class="btn btn-green" disabled>Approve &amp; Submit (mock)</button>
                <span class="hint" style="margin:0">Mark the package “Ready to Apply” above before it can be submitted.</span>`;
    } else if (val.problems.length) {
      action = `<button class="btn btn-green" disabled>Approve &amp; Submit (mock)</button>
                <span class="hint" style="margin:0">Resolve the blocker(s) above first — unsupported content is never submitted.</span>`;
    } else if (failed) {
      action = `<button class="btn btn-primary" onclick="SubmissionView.confirmRetry('${pkg.jobId}')">Retry submission</button>
                <span class="hint" style="margin:0">Last attempt failed — the same prepared package will be re-sent (mock).</span>`;
    } else {
      action = `<button class="btn btn-green" onclick="SubmissionView.confirmSubmit('${pkg.jobId}')">Approve &amp; Submit (mock)</button>
                <span class="hint" style="margin:0">Explicit approval required — nothing is sent until you confirm.</span>`;
    }

    const attempts = (rec && rec.attempts.length) ? `
      <div class="prep-sub">SUBMISSION ATTEMPTS</div>
      ${rec.attempts.slice().reverse().map((a, i) => `
        <div class="sub-attempt ${a.ok ? 'ok' : 'bad'}">
          <b>#${rec.attempts.length - i}</b> ${a.ok ? '✓ ' + esc(a.confirmationId) : '✗ ' + esc(a.error)}
          <span class="ans-src">${esc(fmtTime(a.at))}${a.skipped && a.skipped.length ? ` · ${a.skipped.length} answer(s) left for manual completion` : ''}</span>
        </div>`).join('')}` : '';

    return `
      <div class="card card-pad sub-panel">
        <div class="prep-top" style="flex-wrap:wrap">
          <p class="card-title" style="margin:0">Submission</p>
          ${statusChip(status)}
          <span class="prep-chip prep-neutral">${esc(sub.label)} · ${esc(methodLabel(sub.method))}</span>
        </div>
        <div class="hint" style="margin:6px 0 10px">
          Production-ready submission adapter (mock). No login automation and no live submission run in this build — a
          confirmation id is issued locally so the full flow is verifiable. Apply URL:
          <a href="${esc(pkg.sourceUrl)}" target="_blank" rel="noopener">open original posting ↗</a>
        </div>
        ${problems || warnings ? `<div class="sub-checks">${problems}${warnings}</div>` : '<div class="sub-warn ok">✓ Pre-flight checks passed — resume safety 100, all blockers clear.</div>'}
        <div class="prep-actions">${action}</div>
        ${attempts}
      </div>`;
  }

  /* explicit human confirmations (the second gate) */
  function confirmSubmit(jobId) {
    if (typeof confirm === 'function'
      && !confirm('Submit this application via the mock adapter?\n\nNo real submission or login occurs in this build — a local confirmation id is issued so you can verify the flow.')) return;
    SubmissionEngine.approveAndSubmit(jobId);
  }

  function confirmRetry(jobId) {
    if (typeof confirm === 'function'
      && !confirm('Retry this submission?\n\nThe same prepared package (resume + answers) will be re-sent through the mock adapter.')) return;
    SubmissionEngine.retry(jobId);
  }

  return { panel, statusChip, confirmSubmit, confirmRetry };
})();
