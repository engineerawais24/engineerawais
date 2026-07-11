/* ============================================================
   Pipeline — the production discovery pipeline (Sprint 10A).

   One explicit, ordered flow — each stage is observable in the
   run trace and none of them may abort the run:

     Source → Normalize → Deduplicate → GCC Filter →
     Salary Filter → Company Ranking → Resume Match →
     Decision Engine → Approval Queue → Applications

   RULES ENFORCED HERE (the engines stay untouched):
   • a connector failure is recorded (SyncLog + diagnostics) and
     the remaining sources still publish — graceful degradation
   • unknown salary NEVER filters a job; only an explicitly
     disclosed salary below the user's minimum does (MatchEngine)
   • outside the GCC: Remote stays, relocation/visa-sponsored
     stays, on-site without sponsorship is filtered (MatchEngine)
   • filtered jobs are MARKED, not deleted — the UI keeps its
     "hidden by rules" group exactly as before
   • nothing is ever applied to automatically: the pipeline ends
     at the approval queue; applications require explicit action

   The engines (MatchEngine, RankEngine, DecisionEngine) are
   called read-only; this module only orchestrates + annotates.
   ============================================================ */

const Pipeline = (() => {

  const STAGES = [
    'source', 'normalize', 'dedupe', 'gccFilter', 'salaryFilter',
    'companyRanking', 'resumeMatch', 'decisionEngine',
    'approvalQueue', 'applications',
  ];

  let lastTrace = [];

  function execute() {
    const trace = [];
    const step = (stage, cIn, cOut, meta) => trace.push({ stage, in: cIn, out: cOut, meta: meta || {} });

    /* 1 — SOURCE: enabled boards in priority order; a failed
       connector is logged and skipped, never fatal */
    const cfg = SourcesStore.load();
    const enabledBoards = SourcesStore.BOARDS
      .filter(b => cfg.boards[b.id].enabled)
      .sort((a, b) => cfg.boards[a.id].priority - cfg.boards[b.id].priority);

    let fetched = [];
    const perBoard = [];
    enabledBoards.forEach(b => {
      const r = DailySearch.runBoard(b.id);          // diagnostics + SyncLog inside
      perBoard.push({ id: b.id, label: b.label, count: r.jobs.length, state: r.state, error: r.error });
      fetched = fetched.concat(r.jobs);
    });
    const errors = perBoard.filter(p => p.state !== 'success')
      .map(p => ({ source: p.id, label: p.label, state: p.state, error: p.error }));
    step('source', enabledBoards.length, fetched.length, { boards: enabledBoards.length, failed: errors.length });

    /* 2 — NORMALIZE: every record through the JobSchema contract;
       records without sound identity are dropped and counted */
    const normalized = fetched.map(JobSchema.normalized);
    const valid = normalized.filter(JobSchema.isValid);
    const invalid = normalized.length - valid.length;
    step('normalize', fetched.length, valid.length, { invalid });

    /* 3 — DEDUPLICATE: company+title key; first seen (highest
       priority board) wins, losers recorded on the winner */
    const seen = new Map();
    const kept = [];
    let groupN = 0;
    valid.forEach(j => {
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
    const duplicatesRemoved = valid.length - kept.length;
    step('dedupe', valid.length, kept.length, { removed: duplicatesRemoved });

    /* 4+5 — GCC FILTER, then SALARY FILTER (both verdicts come
       from MatchEngine.evaluate, called once per job; jobs are
       marked, never deleted) */
    const snap = MatchEngine.snapshotFromProfile(Profile.getState(), MasterResume.get());
    const evals = new Map();
    kept.forEach(j => evals.set(j.id, MatchEngine.evaluate(j, snap)));

    let regionFiltered = 0;
    let salaryFiltered = 0;
    let undisclosed = 0;
    kept.forEach(j => {
      const reason = evals.get(j.id).filterReason;
      if (reason === 'region') regionFiltered++;
      if (reason === 'salary') salaryFiltered++;
      if (!j.salaryDisclosed) undisclosed++;
    });
    step('gccFilter', kept.length, kept.length - regionFiltered, { regionFiltered });
    step('salaryFilter', kept.length - regionFiltered,
      kept.length - regionFiltered - salaryFiltered,
      { salaryFiltered, undisclosedKept: undisclosed });

    const qualifying = kept.filter(j => !evals.get(j.id).filtered);
    const qualified = qualifying.length;

    /* 6 — COMPANY RANKING: tier boosts annotated read-only */
    const companiesCfg = (typeof CompaniesStore !== 'undefined') ? CompaniesStore.load() : null;
    let boosted = 0;
    const ranks = new Map();
    qualifying.forEach(j => {
      const rank = (companiesCfg && typeof RankEngine !== 'undefined')
        ? RankEngine.rank(j, evals.get(j.id), companiesCfg) : null;
      ranks.set(j.id, rank);
      if (rank && rank.boost > 0) boosted++;
    });
    step('companyRanking', qualified, qualified, { boosted });

    /* 7 — RESUME MATCH: scores from the read-only profile/master
       snapshot (already computed in evaluate) */
    const avgScore = qualified
      ? Math.round(qualifying.reduce((n, j) => n + evals.get(j.id).score, 0) / qualified) : 0;
    step('resumeMatch', qualified, qualified, { avgScore });

    /* 8 — DECISION ENGINE: recommendation per qualifying job */
    const queue = { autoApprove: 0, manualReview: 0, rejected: 0 };
    qualifying.forEach(j => {
      const d = (typeof DecisionEngine !== 'undefined')
        ? DecisionEngine.decide(j, evals.get(j.id), ranks.get(j.id), snap) : null;
      if (!d) return;
      if (d.outcome === 'auto_approve') queue.autoApprove++;
      else if (d.outcome === 'reject') queue.rejected++;
      else queue.manualReview++;
    });
    step('decisionEngine', qualified, qualified, Object.assign({}, queue));

    /* 9 — APPROVAL QUEUE: everything qualifying goes to Today's
       Jobs for review — no application without explicit approval */
    const sentForReview = qualified;
    step('approvalQueue', qualified, sentForReview, { awaitingApproval: sentForReview });

    /* 10 — APPLICATIONS: publish the discovered set; approved
       jobs become tracked applications only via user action
       (ApplicationsStore.PIPELINE_STATUSES models the rest) */
    JobsStore.setDiscovered(kept);
    step('applications', sentForReview, 0, { autoApplied: 0, note: 'explicit approval required' });

    lastTrace = trace;

    const summary = {
      ranAt: Date.now(),
      /* Sprint 8B shape — unchanged, the UI and tests read these */
      found: fetched.length, duplicatesRemoved, salaryFiltered, regionFiltered,
      qualified, undisclosed, sentForReview, perBoard,
      /* Sprint 10A additions */
      invalid, queue, errors,
    };
    return { jobs: kept, summary, trace };
  }

  return { STAGES, execute, lastTrace: () => lastTrace.slice() };
})();
