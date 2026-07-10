/* ============================================================
   DailySearch — the daily discovery workflow (Sprint 8B).

   Pipeline (run once per day, or on demand):
     1. run every ENABLED source, ordered by priority
     2. normalize raw postings into the unified Job model
     3. remove duplicates (lowest priority number wins; losers
        recorded on the winner's duplicates/duplicateGroupId)
     4. match every job against the profile + master resume
        (read-only) via MatchEngine
     5. apply salary rules (below-threshold disclosed pay filters;
        undisclosed / text pay never filters)
     6. publish qualified jobs to Today's Jobs
   Jobs only ever reach Approvals through explicit user action.

   run() is synchronous and pure-ish (persists results) so tests
   can assert on it; runWithUI() replays the pipeline visually.
   ============================================================ */

const DailySearch = (() => {

  function run() {
    const cfg = SourcesStore.load();
    const enabledBoards = SourcesStore.BOARDS
      .filter(b => cfg.boards[b.id].enabled)
      .sort((a, b) => cfg.boards[a.id].priority - cfg.boards[b.id].priority);

    /* 1+2 — collect normalized jobs per board, in priority order */
    let jobs = [];
    const perBoard = [];
    enabledBoards.forEach(b => {
      const list = Connectors.fetchBoard(b.id, cfg);
      perBoard.push({ id: b.id, label: b.label, count: list.length });
      jobs = jobs.concat(list);
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

    /* 4+5 — match (read-only snapshot) + salary rules */
    const snap = MatchEngine.snapshotFromProfile(Profile.getState(), MasterResume.get());
    let salaryFiltered = 0;
    let undisclosed = 0;
    kept.forEach(j => {
      if (MatchEngine.evaluate(j, snap).filtered) salaryFiltered++;
      if (!j.salaryDisclosed) undisclosed++;
    });
    const qualified = kept.length - salaryFiltered;

    const summary = {
      ranAt: Date.now(),
      found, duplicatesRemoved, salaryFiltered,
      qualified, undisclosed, sentForReview: qualified,
      perBoard,
    };

    /* 6 — publish + persist run state */
    JobsStore.setDiscovered(kept);
    const state = SourcesStore.load();
    enabledBoards.forEach(b => {
      state.boards[b.id].lastRun = summary.ranAt;
      state.boards[b.id].status = 'ok';
    });
    state.lastSummary = summary;
    SourcesStore.save(state);

    if (typeof Jobs !== 'undefined') Jobs.reload();
    if (typeof Activity !== 'undefined') {
      Activity.log('info', `Daily search: ${found} found, ${duplicatesRemoved} duplicates removed, ${qualified} sent for review`);
    }
    return { jobs: kept, summary };
  }

  /* visual replay of the pipeline in the screen area */
  function runWithUI() {
    const screen = document.getElementById('screen');
    if (!screen) { run(); return; }
    const { summary } = run();
    const steps = [
      ...summary.perBoard.map(b => `Queried ${b.label} (mock connector) — ${b.count} posting${b.count === 1 ? '' : 's'}`),
      `Normalized ${summary.found} postings into the unified job model`,
      `Removed duplicates — ${summary.duplicatesRemoved} merged across boards`,
      'Matched against profile & master resume (read-only)',
      `Applied salary rules — ${summary.salaryFiltered} filtered out, ${summary.undisclosed} undisclosed kept`,
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
        box.insertAdjacentHTML('beforeend', `<div class="ds-step">✓ ${steps[i]}</div>`);
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

  return { run, runWithUI };
})();
