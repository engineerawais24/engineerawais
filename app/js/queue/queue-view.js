/* ============================================================
   QueueView — the Application Queue card on the Approvals screen.

   Injected into renderApprovals() the same way PrepView.approvalsCard is.
   Uses only existing CSS classes (card / btn / pill / hint) — no new styles,
   no layout change to the rest of the screen.
   ============================================================ */

const QueueView = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function card() {
    if (typeof ApplicationQueue === 'undefined') return '';
    const s = ApplicationQueue.state();
    const ready = ApplicationQueue.approved();

    /* ---- not started ---- */
    if (!s || !s.active) {
      if (!ready.length) return '';                       // nothing approved → leave Approvals untouched
      return `
        <div class="card card-pad" id="card-queue">
          <p class="card-title">Application queue</p>
          <div class="hint" style="margin-bottom:10px">Work through your ${ready.length} approved job${ready.length > 1 ? 's' : ''} one at a time — open each application, mark it applied, and move to the next. Nothing is ever submitted for you.</div>
          <button class="btn btn-primary" onclick="ApplicationQueue.uiStart()">Start Applying (${ready.length})</button>
        </div>`;
    }

    const prog = ApplicationQueue.progress() || { total: 0, applied: 0, skipped: 0, attention: 0, pending: 0, position: 0 };

    /* ---- complete ---- */
    if (!s.currentId) {
      const revisit = (prog.skipped || prog.attention)
        ? 'Skipped and flagged jobs are still in Approvals whenever you want to revisit them.'
        : 'Every approved job has been handled.';
      return `
        <div class="card card-pad" id="card-queue">
          <p class="card-title">Application queue — complete</p>
          <div class="hint" style="margin-bottom:10px">${prog.applied} applied · ${prog.skipped} skipped · ${prog.attention} need attention. ${revisit}</div>
          <button class="btn btn-primary" onclick="ApplicationQueue.uiFinish()">Done</button>
        </div>`;
    }

    /* ---- current job ---- */
    const pkg = ApplicationQueue.current();
    if (!pkg) {
      return `
        <div class="card card-pad" id="card-queue">
          <p class="card-title">Application queue</p>
          <div class="hint" style="margin-bottom:10px">This job is no longer available — move on to the next one.</div>
          <button class="btn btn-primary" onclick="ApplicationQueue.uiOpenNext()">Open Next</button>
          <button class="btn btn-ghost" onclick="ApplicationQueue.uiFinish()">End queue</button>
        </div>`;
    }

    const job = pkg.job;
    const url = ApplicationQueue.jobUrl(pkg);
    const outcome = ApplicationQueue.outcomeOf(s.currentId);
    const flagged = outcome === 'attention';
    const applied = (typeof ApplicationPackages !== 'undefined') && pkg.status === ApplicationPackages.APPLIED;

    return `
      <div class="card card-pad" id="card-queue">
        <div class="prep-top" style="flex-wrap:wrap; align-items:center; gap:8px">
          <p class="card-title" style="margin:0">Application queue</p>
          <span class="pill">Job ${prog.position} of ${prog.total}</span>
          ${flagged ? '<span class="pill pill-amber">Needs attention</span>' : ''}
          ${applied ? '<span class="pill pill-green">Applied</span>' : ''}
        </div>
        <div class="hint" style="margin:8px 0 4px">${prog.applied} applied · ${prog.skipped} skipped · ${prog.attention} flagged · ${prog.pending} left</div>
        <div style="margin:8px 0 12px">
          <div style="font-weight:600; font-size:15px">${esc(job.title)} <span style="color:var(--faint)">· ${esc(job.company)}</span></div>
          <div class="hint">${esc(job.location || '')}${job.source ? ` · ${esc(job.source)}` : ''}${pkg.matchScore != null ? ` · match ${pkg.matchScore}` : ''}</div>
          ${url
            ? `<div class="hint" style="font-family:var(--mono); font-size:10.5px; word-break:break-all; margin-top:4px">${esc(url)}</div>`
            : '<div class="hint" style="color:var(--amber); margin-top:4px">No application URL on this job — open it manually.</div>'}
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
          <button class="btn btn-green"   onclick="ApplicationQueue.uiApplied()">Mark Applied</button>
          <button class="btn btn-ghost"   onclick="ApplicationQueue.uiAttention()">Needs Attention</button>
          <button class="btn btn-ghost"   onclick="ApplicationQueue.uiSkip()">Skip</button>
          <button class="btn btn-primary" onclick="ApplicationQueue.uiOpenNext()" ${url ? '' : 'disabled'}>Open Next</button>
          <button class="btn btn-ghost" style="margin-left:auto" onclick="ApplicationQueue.uiFinish()">End queue</button>
        </div>
      </div>`;
  }

  return { card };
})();
