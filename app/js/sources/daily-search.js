/* ============================================================
   DailySearch — the daily discovery workflow (Sprint 8B → 9A).

   9A: boards run through the ConnectorBase adapter interface.
   Each enabled connector is executed with SearchParams, paged
   until exhausted, and its DIAGNOSTICS recorded (state, last
   run, jobs found, error, rate-limit). A failed connector never
   aborts the run — the pipeline degrades gracefully and every
   other source still publishes.

   Pipeline stays: collect → normalize (inside adapters) →
   dedupe by priority → match (read-only) → salary + GCC rules →
   publish to Today's Jobs. Approvals only via explicit action.
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

    return { ok: last.ok, jobs, state: last.state, error: last.ok ? null : last.error };
  }

  function run() {
    const cfg = SourcesStore.load();
    const enabledBoards = SourcesStore.BOARDS
      .filter(b => cfg.boards[b.id].enabled)
      .sort((a, b) => cfg.boards[a.id].priority - cfg.boards[b.id].priority);

    /* 1+2 — collect via adapters (normalized inside), in priority order */
    let jobs = [];
    const perBoard = [];
    enabledBoards.forEach(b => {
      const r = runBoard(b.id);
      perBoard.push({ id: b.id, label: b.label, count: r.jobs.length, state: r.state, error: r.error });
      jobs = jobs.concat(r.jobs);
    });
    const found = jobs.length;

    /* 3 — dedupe on company+title; first seen (highest priority) wins */
    const seen = new Map();
    const kept = [];
    let groupN = 0;
    jobs.forEach(j => {
      const key = (j.company + '|' + j.title).toLowerCase().replace(/[^a-z0-9|]+/g, ' ').trim();
      const winner = seen.get(key);
      if (winner) {
        if (!winner.duplicateGroupId) winner.duplicateGroupId = 'dg-' + (++groupN);
        winner.duplicates.push(j.source);
      } else {
        seen.set(key, j);
        kept.push(j);
      }
    });
    const duplicatesRemoved = found - kept.length;

    /* 4+5 — match (read-only snapshot) + salary and GCC region rules */
    const snap = MatchEngine.snapshotFromProfile(Profile.getState(), MasterResume.get());
    let salaryFiltered = 0;
    let regionFiltered = 0;
    let undisclosed = 0;
    kept.forEach(j => {
      const reason = MatchEngine.evaluate(j, snap).filterReason;
      if (reason === 'salary') salaryFiltered++;
      if (reason === 'region') regionFiltered++;
      if (!j.salaryDisclosed) undisclosed++;
    });
    const qualified = kept.length - salaryFiltered - regionFiltered;

    const summary = {
      ranAt: Date.now(),
      found, duplicatesRemoved, salaryFiltered, regionFiltered,
      qualified, undisclosed, sentForReview: qualified,
      perBoard,
    };

    /* 6 — publish + persist run state */
    JobsStore.setDiscovered(kept);
    const state = SourcesStore.load();
    state.lastSummary = summary;
    SourcesStore.save(state);

    if (typeof Jobs !== 'undefined') Jobs.reload();
    if (typeof Activity !== 'undefined') {
      const failures = perBoard.filter(p => p.state !== 'success').length;
      Activity.log('info', `Daily search: ${found} found, ${duplicatesRemoved} duplicates removed, ${qualified} sent for review${failures ? `, ${failures} connector${failures > 1 ? 's' : ''} degraded` : ''}`);
    }
    return { jobs: kept, summary };
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
