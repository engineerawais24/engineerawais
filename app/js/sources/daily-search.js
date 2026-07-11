/* ============================================================
   DailySearch — the daily discovery workflow (Sprint 8B → 10A).

   10A: orchestration moved into Pipeline (pipeline.js) — the
   explicit Source → Normalize → Dedupe → GCC → Salary → Ranking
   → Match → Decision → Approval Queue → Applications flow.
   DailySearch keeps the connector-level concerns: runBoard()
   executes ONE adapter with SearchParams, pages until exhausted,
   records DIAGNOSTICS (state, last run, jobs found, error,
   rate-limit) and appends a SyncLog entry (source, time, error,
   retry count, last successful sync). A failed connector never
   aborts the run — the pipeline degrades gracefully and every
   other source still publishes. retryBoard() is the manual
   retry; SyncLog.retryCountOf() feeds real backoff later.
   ============================================================ */

const DailySearch = (() => {

  const MAX_PAGES = 5;

  /* default SearchParams — deliberately broad; per-user narrowing
     arrives with saved searches. postedSince keeps feeds fresh. */
  function baseParams() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return { query: '', location: '', workMode: '', postedSince: since, pageSize: 25 };
  }

  /* run one connector through the adapter interface, recording
     diagnostics. probe=true fetches a single small page only. */
  function runBoard(boardId, opts = {}) {
    const adapter = Connectors.get(boardId);
    const state = SourcesStore.load();
    const diag = state.boards[boardId];
    if (!adapter || !diag) return { ok: false, jobs: [], state: 'failed', error: 'Unknown connector' };

    diag.state = 'running';
    diag.lastRun = Date.now();
    diag.runs = (diag.runs || 0) + 1;
    SourcesStore.save(state);

    let jobs = [];
    let page = 1;
    let last;
    do {
      last = adapter.fetch(Object.assign(baseParams(), opts.probe ? { pageSize: 1 } : {}, { page }));
      if (last.ok) jobs = jobs.concat(last.jobs);
      page++;
    } while (last.ok && last.hasMore && !opts.probe && page <= MAX_PAGES);

    /* persist diagnostics */
    const after = SourcesStore.load();
    const d = after.boards[boardId];
    d.lastRun = Date.now();
    d.state = last.state;
    d.lastError = last.ok ? null : (last.error || 'Unknown error');
    d.rateLimitedUntil = last.retryAfter ? Date.now() + last.retryAfter : null;
    if (last.ok) {
      d.lastSuccess = Date.now();
      d.jobsFound = jobs.length;
    }
    SourcesStore.save(after);

    /* append to the sync log — source, time, error, retry count,
       last successful sync (Sprint 10A error-handling contract) */
    if (typeof SyncLog !== 'undefined') {
      SyncLog.record({
        source: boardId, sourceLabel: adapter.label,
        ok: last.ok, state: last.state,
        error: last.ok ? null : last.error, jobs: jobs.length,
      });
    }

    return { ok: last.ok, jobs, state: last.state, error: last.ok ? null : last.error };
  }

  /* full daily run — delegates to the Sprint 10A Pipeline
     (Source → Normalize → Dedupe → GCC → Salary → Ranking →
     Match → Decision → Approval Queue → Applications) and keeps
     the summary contract every screen already reads */
  function run() {
    const { jobs, summary, trace } = Pipeline.execute();

    /* persist run state for the Settings + Today's Jobs cards */
    const state = SourcesStore.load();
    state.lastSummary = summary;
    SourcesStore.save(state);

    if (typeof Jobs !== 'undefined') Jobs.reload();
    if (typeof Activity !== 'undefined') {
      const failures = summary.perBoard.filter(p => p.state !== 'success').length;
      Activity.log('info', `Daily search: ${summary.found} found, ${summary.duplicatesRemoved} duplicates removed, ${summary.qualified} sent for review${failures ? `, ${failures} connector${failures > 1 ? 's' : ''} degraded` : ''}`);
    }
    return { jobs, summary, trace };
  }

  /* per-connector retry / test-connection (diagnostics buttons) */
  function retryBoard(boardId, opts = {}) {
    const r = runBoard(boardId, opts);
    if (typeof toast === 'function') {
      const label = (Connectors.get(boardId) || {}).label || boardId;
      toast(r.ok
        ? `${label}: ${opts.probe ? 'connection OK' : r.jobs.length + ' jobs fetched'} (${ConnectorBase.STATE_LABELS[r.state]})`
        : `${label}: ${r.error}`, r.ok ? 'success' : 'error');
    }
    return r;
  }

  /* visual replay of the pipeline in the screen area */
  function runWithUI() {
    const screen = document.getElementById('screen');
    if (!screen) { run(); return; }
    const { summary } = run();
    const steps = [
      ...summary.perBoard.map(b => b.state === 'success'
        ? `Queried ${b.label} — ${b.count} posting${b.count === 1 ? '' : 's'}`
        : `⚠ ${b.label}: ${ConnectorBase.STATE_LABELS[b.state]} — skipped (${b.error || 'see diagnostics'})`),
      `Normalized ${summary.found} postings into the unified job model`,
      `Removed duplicates — ${summary.duplicatesRemoved} merged across boards`,
      'Matched against profile & master resume (read-only)',
      `Applied salary + GCC region rules — ${summary.salaryFiltered} salary-filtered, ${summary.regionFiltered} region-filtered, ${summary.undisclosed} undisclosed kept`,
      `Published ${summary.sentForReview} qualified jobs to Today's Jobs`,
    ];
    screen.innerHTML = `
      <div class="card card-pad ds-run">
        <p class="card-title">Daily search running…</p>
        <div id="ds-steps"></div>
      </div>`;
    const box = document.getElementById('ds-steps');
    let i = 0;
    (function tick() {
      if (!box || !box.isConnected) return;     // user navigated away
      if (i < steps.length) {
        box.insertAdjacentHTML('beforeend', `<div class="ds-step">${steps[i].startsWith('⚠') ? '' : '✓ '}${steps[i]}</div>`);
        i++;
        setTimeout(tick, 260);
      } else {
        setTimeout(() => {
          location.hash = '#/jobs';
          navigate();
          toast(`Daily search complete — ${summary.sentForReview} jobs sent for review`);
        }, 350);
      }
    })();
  }

  return { run, runBoard, retryBoard, runWithUI, baseParams };
})();
