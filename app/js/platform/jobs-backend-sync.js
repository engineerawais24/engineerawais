/* ============================================================
   JobsBackendSync — pull backend-saved jobs into Today's Jobs.

   The bug this fixes
   ------------------
   The Chrome extension's "Save Current Job" writes to the backend
   (POST /api/jobs) and reports success — but Today's Jobs is local-first and
   only reads localStorage, so the saved job never appeared, even after a
   refresh.

   The fix
   -------
   A read-side counterpart to ProfileAutoSync: when the backend is reachable,
   GET /api/jobs and fold each row into the EXISTING ImportedJobs store (which
   already renders inside Today's Jobs and flows through review → approve →
   apply). Reuses the existing job endpoint and job model — no new backend, no
   new job schema.

   Safe + additive
   ---------------
     • DEDUPED by canonical URL — a re-pull never creates a second copy, and a
       job that already exists locally is left untouched (no duplicates).
     • Existing local/imported jobs are preserved — this only ADDS.
     • Best-effort + silent — skips when the backend is unreachable, never
       blocks the UI, throttled so navigation can't spam it.
     • Does not touch the queue or autofill, and adds no UI.
   ============================================================ */

const JobsBackendSync = (() => {

  let lastPullAt = 0;
  const MIN_INTERVAL = 8000;          // don't re-pull more than once per 8s (unless forced)

  function client() { return (typeof APIClient !== 'undefined') ? APIClient : null; }
  function base() { return (typeof Backend !== 'undefined') ? Backend.baseUrl() : ''; }

  async function fetchJobs(opts) {
    const c = client();
    if (!c) return null;
    try {
      const r = await c.request('GET', base() + '/api/jobs?limit=200', { retries: 0, timeout: (opts && opts.timeout) || 8000 });
      return (r && Array.isArray(r.data)) ? r.data : null;
    } catch (e) {
      return null;                    // unreachable / error → skip silently
    }
  }

  /* re-render Today's Jobs if the user is on it (and not mid-typing) */
  function refreshBoard() {
    if (typeof currentRoute !== 'function' || currentRoute() !== 'jobs') return;
    const a = (typeof document !== 'undefined') ? document.activeElement : null;
    const busy = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '');
    if (!busy && typeof navigate === 'function') navigate();
  }

  async function pull(opts) {
    opts = opts || {};
    const now = Date.now();
    if (!opts.force && now - lastPullAt < MIN_INTERVAL) return { skipped: true, reason: 'throttled' };
    if (typeof ImportedJobs === 'undefined') return { skipped: true, reason: 'imports unavailable' };

    const jobs = await fetchJobs(opts);
    if (!jobs) return { skipped: true, reason: 'backend unreachable' };
    lastPullAt = now;

    let added = 0, duplicate = 0, skipped = 0;
    jobs.forEach(bj => {
      const r = ImportedJobs.upsertFromBackend(bj);
      if (!r || !r.ok) { skipped++; return; }
      if (r.duplicate) duplicate++; else added++;
    });

    if (added) refreshBoard();
    return { ok: true, total: jobs.length, added, duplicate, skipped };
  }

  return { pull };
})();
