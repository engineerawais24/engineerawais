/* ============================================================
   ApplicationQueue — process approved jobs one at a time (v1).

   What it is
   ----------
   A thin processing session over the jobs the user has already approved.
   The approved jobs ARE the existing Sprint 23 application packages at
   status "ready_to_apply" (`ApplicationPackages.ready()`) — created by the
   Today's-Jobs approve flow, each carrying a frozen job with an apply URL.
   Nothing here is a new job/approval store; only the tiny per-session queue
   state (order + per-job outcome + which job is current) is new.

   The flow
   --------
     Start Applying → snapshot the approved jobs, select the first, and open
     its application page in a new tab.
     Then, per job: Mark Applied · Needs Attention · Skip · Open Next.
       • Mark Applied → ApplicationPackages.markApplied() (feeds the board),
         then auto-select the next approved job.
       • Skip        → leave the package untouched, auto-select the next.
       • Needs Attention → flag it and STAY (the user deals with it, then
         Open Next / Skip to move on).
       • Open Next   → open the current job's application page in a new tab
         (advancing first if the current one is already resolved).

   Guarantees
   ----------
     • NEVER submits an application — it only opens the apply URL in a tab;
       the user applies and clicks Mark Applied themselves.
     • No duplicate processing — a job already applied (here or on the board)
       is skipped when selecting the next; markApplied is idempotent; Start
       while a queue is active RESUMES it rather than rebuilding.
     • Queue state is persisted through AppStorage (localStorage), so a
       browser refresh resumes exactly where you were.
   ============================================================ */

const ApplicationQueue = (() => {

  const KEY = 'application_queue';

  /* ---------- persisted session state ----------
     { active, order:[jobId…], outcomes:{jobId:'applied'|'skipped'|'attention'},
       currentId, startedAt, completedAt } */
  function state() {
    const s = (typeof AppStorage !== 'undefined') ? AppStorage.get(KEY) : null;
    return (s && typeof s === 'object') ? s : null;
  }
  function persist(s) { if (typeof AppStorage !== 'undefined') AppStorage.set(KEY, s); return s; }
  function isActive() { const s = state(); return !!(s && s.active); }

  /* ---------- the approved jobs (reused, not re-modelled) ---------- */
  function packages() { return (typeof ApplicationPackages !== 'undefined') ? ApplicationPackages : null; }
  function approved() { const P = packages(); return P ? P.ready() : []; }
  function pkgFor(jobId) { const P = packages(); return P ? P.forJob(jobId) : null; }

  function jobUrl(pkg) {
    const j = pkg && pkg.job;
    if (!j) return '';
    return j.applyUrl || j.url || j.canonicalUrl || '';
  }

  /* a job's live status in the queue. A stored outcome wins; otherwise the
     package's own status decides — a package that is no longer "ready" was
     applied (or removed) elsewhere, so it is already done, never re-processed. */
  function outcomeIn(s, jobId) {
    if (s && s.outcomes && s.outcomes[jobId]) return s.outcomes[jobId];
    const P = packages();
    const pkg = pkgFor(jobId);
    if (!pkg) return 'gone';
    if (P && pkg.status !== P.READY) return 'done';
    return 'pending';
  }
  function outcomeOf(jobId) { const s = state(); return s ? outcomeIn(s, jobId) : 'pending'; }
  function isPending(s, jobId) { return outcomeIn(s, jobId) === 'pending'; }

  /* first still-pending job after `afterId` (wrapping once so an earlier
     pending is never stranded) */
  function nextPending(s, afterId) {
    const order = s.order || [];
    const start = afterId ? order.indexOf(afterId) + 1 : 0;
    for (let i = start; i < order.length; i++) if (isPending(s, order[i])) return order[i];
    for (let i = 0; i < start; i++) if (isPending(s, order[i])) return order[i];
    return null;
  }

  function current() {
    const s = state();
    if (!s || !s.active || !s.currentId) return null;
    return pkgFor(s.currentId);
  }

  /* open a URL in a new tab — the ONLY outward action the queue ever takes.
     Never submits anything. */
  function openTab(url) {
    try {
      if (url && typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(url, '_blank', 'noopener');
        return true;
      }
    } catch (e) { /* pop-up blocked / no window */ }
    return false;
  }

  /* open the job AND tell the extension it was opened from the Queue, so the
     Chrome extension can auto-run Autofill v2 on that tab (Queue → ATS Auto
     Autofill). The signal is best-effort; if the extension isn't installed the
     tab just opens normally. */
  function openAndSignal(jobId, url) {
    if (url && typeof QueueAutoApply !== 'undefined' && QueueAutoApply.signalOpen) {
      try { QueueAutoApply.signalOpen({ jobId, url }); } catch (e) { /* extension optional */ }
    }
    return openTab(url);
  }

  /* ---------- actions (logic only — no toast, no re-render) ---------- */

  function start() {
    const list = approved();
    if (!list.length) return { ok: false, error: 'No approved jobs to apply to yet' };

    const existing = state();
    if (existing && existing.active) return { ok: true, resumed: true, state: existing };  // never rebuild over an active queue

    const s = {
      active: true,
      order: list.map(p => p.jobId),
      outcomes: {},
      currentId: list[0].jobId,
      startedAt: Date.now(),
      completedAt: null,
    };
    persist(s);
    const url = jobUrl(pkgFor(s.currentId));
    const opened = url ? openAndSignal(s.currentId, url) : false;
    return { ok: true, started: true, state: s, currentId: s.currentId, url, opened };
  }

  function markApplied() {
    const s = state();
    if (!s || !s.active || !s.currentId) return { ok: false, error: 'No active queue' };
    const jobId = s.currentId;
    const P = packages();
    const pkg = pkgFor(jobId);
    let applied = false;
    /* only mark on the board if it is genuinely still ready — idempotent, so
       a job already applied is never applied a second time */
    if (P && pkg && pkg.status === P.READY) applied = !!P.markApplied(pkg.id);
    s.outcomes[jobId] = 'applied';
    s.currentId = nextPending(s, jobId);
    if (!s.currentId) s.completedAt = Date.now();
    persist(s);
    return { ok: true, jobId, applied, currentId: s.currentId, done: !s.currentId };
  }

  function skip() {
    const s = state();
    if (!s || !s.active || !s.currentId) return { ok: false, error: 'No active queue' };
    const jobId = s.currentId;
    s.outcomes[jobId] = 'skipped';                 // the package is left exactly as it was
    s.currentId = nextPending(s, jobId);
    if (!s.currentId) s.completedAt = Date.now();
    persist(s);
    return { ok: true, jobId, currentId: s.currentId, done: !s.currentId };
  }

  function needsAttention() {
    const s = state();
    if (!s || !s.active || !s.currentId) return { ok: false, error: 'No active queue' };
    const jobId = s.currentId;
    s.outcomes[jobId] = 'attention';               // flag it; stay on it (no auto-advance)
    persist(s);
    return { ok: true, jobId, currentId: s.currentId };
  }

  function openNext() {
    const s = state();
    if (!s || !s.active) return { ok: false, error: 'No active queue' };
    /* if the current job is already resolved (e.g. flagged Needs Attention),
       advance to the next pending one first, then open it */
    if (s.currentId && !isPending(s, s.currentId)) {
      s.currentId = nextPending(s, s.currentId);
      if (!s.currentId) s.completedAt = Date.now();
      persist(s);
    }
    if (!s.currentId) return { ok: false, error: 'No more approved jobs in the queue', done: true };
    const url = jobUrl(pkgFor(s.currentId));
    if (!url) return { ok: false, error: 'This job has no application URL', currentId: s.currentId };
    return { ok: openAndSignal(s.currentId, url), currentId: s.currentId, url };
  }

  /* is this job currently in an active queue session? */
  function isQueued(jobId) {
    const s = state();
    return !!(s && s.active && (s.order || []).indexOf(jobId) !== -1);
  }

  /* add ONE approved job to the Application Queue — the "Approve & queue"
     action on Approvals. The job must have a ready application package. Never
     opens a tab (opening only happens as the user works the queue) and never
     queues the same job twice. */
  function enqueue(jobId) {
    const P = packages();
    const pkg = P ? P.forJob(jobId) : null;
    if (!pkg) return { ok: false, error: 'No application to queue for this job' };
    if (pkg.status !== P.READY) return { ok: false, error: 'This job is not ready to apply' };

    let s = state();
    if (!s || !s.active) {
      /* no session yet → open one containing just this job (no auto-open of a
         tab; that happens as the user works the queue) */
      s = { active: true, order: [jobId], outcomes: {}, currentId: jobId, startedAt: Date.now(), completedAt: null };
      persist(s);
      return { ok: true, enqueued: jobId, started: true, currentId: jobId };
    }
    /* active session → append if absent; if it had finished, make this current */
    if (s.order.indexOf(jobId) === -1) s.order.push(jobId);
    if (!s.currentId) s.currentId = jobId;
    persist(s);
    return { ok: true, enqueued: jobId };
  }

  /* flag a SPECIFIC job as needing attention — used when the extension's
     auto-apply reports a login/CAPTCHA/blocked/no-form page for a job it
     opened. Never overrides a job already applied. */
  function markAttentionFor(jobId, opts) {
    const s = state();
    if (!s || !s.active || !jobId) return { ok: false };
    if ((s.order || []).indexOf(jobId) === -1) return { ok: false, reason: 'not in queue' };
    const cur = outcomeIn(s, jobId);
    if (cur === 'applied' || cur === 'done') return { ok: false, reason: 'already applied' };
    s.outcomes[jobId] = 'attention';
    if (opts && opts.reason) { s.attentionReasons = s.attentionReasons || {}; s.attentionReasons[jobId] = opts.reason; }
    persist(s);
    return { ok: true, jobId };
  }

  function finish() {
    if (typeof AppStorage !== 'undefined') AppStorage.set(KEY, null);
    return { ok: true };
  }

  function progress() {
    const s = state();
    if (!s || !s.active) return null;
    const order = s.order || [];
    let applied = 0, skipped = 0, attention = 0, pending = 0;
    order.forEach(id => {
      const o = outcomeIn(s, id);
      if (o === 'skipped') skipped++;
      else if (o === 'attention') attention++;
      else if (o === 'pending') pending++;
      else applied++;                              // 'applied' or 'done'
    });
    const idx = s.currentId ? order.indexOf(s.currentId) : order.length;
    return { total: order.length, applied, skipped, attention, pending, position: idx + 1, done: !s.currentId };
  }

  /* ---------- UI wrappers (toast + re-render) ---------- */
  function toastMsg(m, t) { if (typeof toast === 'function') toast(m, t); }
  function refresh() {
    if (typeof currentRoute === 'function' && currentRoute() === 'approvals' && typeof navigate === 'function') navigate();
  }

  function uiStart() {
    const r = start();
    if (!r.ok) { toastMsg(r.error, 'info'); return r; }
    toastMsg(r.resumed ? 'Resumed your application queue' : 'Applying — opened the first job in a new tab', 'success');
    refresh();
    return r;
  }
  function uiApplied() {
    const r = markApplied();
    if (!r.ok) { toastMsg(r.error, 'info'); return r; }
    toastMsg(r.done ? 'Marked applied — queue complete' : 'Marked applied — next job selected', 'success');
    refresh();
    return r;
  }
  function uiSkip() {
    const r = skip();
    if (!r.ok) { toastMsg(r.error, 'info'); return r; }
    toastMsg(r.done ? 'Skipped — queue complete' : 'Skipped — next job selected', 'info');
    refresh();
    return r;
  }
  function uiAttention() {
    const r = needsAttention();
    if (!r.ok) { toastMsg(r.error, 'info'); return r; }
    toastMsg('Flagged as needing attention — still in Approvals to revisit', 'info');
    refresh();
    return r;
  }
  function uiOpenNext() {
    const r = openNext();
    if (!r.ok) toastMsg(r.error, 'info');
    refresh();
    return r;
  }
  function uiFinish() {
    finish();
    toastMsg('Application queue closed', 'info');
    refresh();
  }
  function uiEnqueue(jobId) {
    const r = enqueue(jobId);
    if (!r.ok) { toastMsg(r.error, 'error'); return r; }
    toastMsg('Added to your Application Queue', 'success');
    refresh();
    return r;
  }

  return {
    KEY,
    /* state + reads */
    state, isActive, approved, current, jobUrl, outcomeOf, progress, isQueued,
    /* actions (logic) */
    start, markApplied, skip, needsAttention, markAttentionFor, openNext, finish, enqueue,
    /* UI wrappers (used by the Approvals card) */
    uiStart, uiApplied, uiSkip, uiAttention, uiOpenNext, uiFinish, uiEnqueue,
  };
})();
