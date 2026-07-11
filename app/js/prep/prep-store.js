/* ============================================================
   PrepStore — application-package persistence (Sprint 10C).

   One package per approved job, keyed by job id. A package is
   the COMPLETE application bundle:

     { id, jobId, v, createdAt, status, statusTrail,
       job          — the exact job record (frozen copy)
       sourceUrl    — the exact original posting URL
       sources      — every board's provenance (10B merge)
       resume       — { label, base, plan, safety, interviewCheck,
                        audit, interviewConfidence, matched }
       coverLetter  — full draft text
       answers      — AnswersEngine output (13 questions, Sprint 12)
       matchScore   — MatchEngine score at approval time
       decision     — DecisionEngine explanation (reasons ✓/✗)
       missingInfo  — facts the posting wants that we can't prove
       flaggedAnswers, blockers }

   PREPARATION STATUSES (Sprint 10C):
     approved → preparing_resume → preparing_cover_letter →
     preparing_answers → ready_for_review → ready_to_apply
     (or → blocked_manual_review when anything lacks provenance)

   Submission does not exist in this build — ready_to_apply is
   the final state and requires the user's explicit action.
   ============================================================ */

const PrepStore = (() => {

  const KEY = 'careerpilot_prep_v1';

  const STATUSES = [
    { id: 'approved',              label: 'Approved' },
    { id: 'preparing_resume',      label: 'Preparing Resume' },
    { id: 'preparing_cover_letter', label: 'Preparing Cover Letter' },
    { id: 'preparing_answers',     label: 'Preparing Answers' },
    { id: 'ready_for_review',      label: 'Ready for Review' },
    { id: 'ready_to_apply',        label: 'Ready to Apply' },
    { id: 'blocked_manual_review', label: 'Blocked for Manual Review' },
  ];

  function statusLabel(id) {
    const s = STATUSES.find(x => x.id === id);
    return s ? s.label : id;
  }

  function load() {
    const base = { packages: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.packages === 'object') base.packages = saved.packages;
    } catch (e) { /* corrupt → empty, never breaks a screen */ }
    return base;
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function all() {
    return Object.values(load().packages);
  }

  function get(jobId) {
    return load().packages[jobId] || null;
  }

  function put(pkg) {
    const state = load();
    state.packages[pkg.jobId] = pkg;
    return save(state);
  }

  function remove(jobId) {
    const state = load();
    delete state.packages[jobId];
    return save(state);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, STATUSES, statusLabel, load, save, all, get, put, remove, clear };
})();
