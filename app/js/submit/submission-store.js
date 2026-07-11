/* ============================================================
   SubmissionStore — application-submission persistence (Sprint 12).

   The preparation phase (Sprint 10C) ends at ready_to_apply and
   lives in PrepStore. Sprint 12 adds the SUBMISSION phase: one
   record per job, keyed by jobId, that tracks a real (mock, for
   now) submission attempt through a production-ready adapter.

   A submission record is the AUDIT TRAIL of an application:

     { id, jobId, status, createdAt, updatedAt,
       submitter      — { id, label, method } chosen for the job
       approvedByUser — timestamp of the explicit human approval
                        (there is NO submission without it)
       snapshot       — the EXACT resume + answers + cover letter
                        used, frozen at submit time (never mutated
                        afterwards, so what was sent is provable)
       attempts       — [{ at, ok, state, error, confirmationId,
                          steps: [{ step, ok, note }] }]
       attemptCount, lastError,
       confirmationId, submittedAt }   (set only on success)

   SUBMISSION STATES (Sprint 12 PART 3) — the full lifecycle. The
   first seven are owned by the preparation phase and shown here
   only for labelling; the store itself only ever SETS the last
   four (submission_started → submitted | submission_failed →
   retry_required). A failed submission NEVER becomes 'submitted'.
   ============================================================ */

const SubmissionStore = (() => {

  const KEY = 'careerpilot_submissions_v1';

  const STATES = [
    { id: 'approved',               label: 'Approved',                phase: 'prep' },
    { id: 'preparing_resume',       label: 'Preparing Resume',        phase: 'prep' },
    { id: 'preparing_cover_letter', label: 'Preparing Cover Letter',  phase: 'prep' },
    { id: 'preparing_answers',      label: 'Preparing Answers',       phase: 'prep' },
    { id: 'manual_review_required', label: 'Manual Review Required',  phase: 'prep' },
    { id: 'ready_for_review',       label: 'Ready for Review',        phase: 'prep' },
    { id: 'ready_to_apply',         label: 'Ready to Apply',          phase: 'prep' },
    { id: 'submission_started',     label: 'Submission Started',      phase: 'submit' },
    { id: 'submitted',              label: 'Submitted',               phase: 'submit' },
    { id: 'submission_failed',      label: 'Submission Failed',       phase: 'submit' },
    { id: 'retry_required',         label: 'Retry Required',          phase: 'submit' },
  ];

  const SUCCESS = 'submitted';
  const FAILURE = ['submission_failed', 'retry_required'];
  const ID_OF = STATES.map(s => s.id);

  function statusLabel(id) {
    const s = STATES.find(x => x.id === id);
    return s ? s.label : id;
  }
  function isKnownState(id) { return ID_OF.includes(id); }
  function isSuccess(id) { return id === SUCCESS; }
  function isFailure(id) { return FAILURE.includes(id); }

  function load() {
    const base = { records: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.records === 'object' && saved.records) base.records = saved.records;
    } catch (e) { /* corrupt → empty, never breaks a screen */ }
    return base;
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  function all() { return Object.values(load().records); }
  function get(jobId) { return load().records[jobId] || null; }

  function put(rec) {
    if (!rec || !rec.jobId) return false;
    rec.updatedAt = Date.now();
    const state = load();
    state.records[rec.jobId] = rec;
    return save(state);
  }

  function remove(jobId) {
    const state = load();
    delete state.records[jobId];
    return save(state);
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return {
    KEY, STATES, SUCCESS, FAILURE,
    statusLabel, isKnownState, isSuccess, isFailure,
    load, save, all, get, put, remove, clear,
  };
})();
