/* ============================================================
   ApplicationPackages — the package created when a job is
   approved (Sprint 23).

   One package per job: a frozen copy of the job, the résumé
   selected for it (Sprint 21), the generated cover letter
   (Sprint 22), the match score, the approval date and a status.
   It starts at "Ready to Apply" and only ever leaves that state
   because the user says so — nothing here submits anything to a
   job board, and no backend is involved.

   Persisted through the existing AppStorage platform abstraction,
   the same one Sprints 19/21/22 use. It never touches the locked
   master résumé, the Résumé Library, or the Approvals package
   that Prep already builds — those are separate systems.
   ============================================================ */

const ApplicationPackages = (() => {

  const STORAGE_KEY = 'application_packages';

  const READY = 'ready_to_apply';
  const APPLIED = 'applied';
  const STATUS_LABEL = { ready_to_apply: 'Ready to Apply', applied: 'Applied' };

  const today = () => new Date().toISOString().slice(0, 10);

  function all() {
    const list = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    return Array.isArray(list) ? list : [];
  }
  function persist(list) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, list);
    return list;
  }

  function get(id) { return all().find(p => p.id === id) || null; }
  function forJob(jobId) { return all().find(p => p.jobId === jobId) || null; }
  function has(jobId) { return !!forJob(jobId); }
  function ready() { return all().filter(p => p.status === READY); }
  function statusLabel(s) { return STATUS_LABEL[s] || s; }

  /* ---------- the two things the package is built from ---------- */

  function selectedResume(job) {
    if (typeof ResumeRecommender === 'undefined') return null;
    const r = ResumeRecommender.forJob(job);
    return r ? r.selected : null;
  }

  /* reuse the letter already drafted on the job card; only generate
     one if the user never did (Sprint 22 keeps one letter per job) */
  function coverLetterFor(job) {
    if (typeof CoverLetter === 'undefined') return null;
    return CoverLetter.get(job.id) || CoverLetter.generate(job);
  }

  /* ---------- create (on approve) ---------- */

  /* `item` is an entry from Jobs.evaluated(): { job, res, … } */
  function createFrom(item) {
    if (!item || !item.job || !item.job.id) return null;
    const job = item.job;

    /* one package per job — approving twice never creates a second */
    const existing = forJob(job.id);
    if (existing) return existing;

    const resume = selectedResume(job);
    const letter = coverLetterFor(job);

    const pkg = {
      id: 'pkg-' + job.id,
      jobId: job.id,
      job: JSON.parse(JSON.stringify(job)),          // frozen copy of the posting
      resumeId: resume ? resume.id : null,
      resumeName: resume ? resume.name : null,
      coverLetter: letter ? letter.text : '',
      coverLetterResumeId: letter ? letter.resumeId : null,
      matchScore: (item.res && typeof item.res.score === 'number') ? item.res.score : null,
      approvedOn: today(),
      approvedAt: Date.now(),
      status: READY,
      appliedOn: null,
    };
    persist(all().concat([pkg]));
    return pkg;
  }

  /* ---------- change the résumé on a package ---------- */

  /* Re-selects the résumé for this job and rewrites the cover letter to
     match — the package can never carry a letter for a different résumé.
     Only while the package is still Ready to Apply: once it's been sent,
     the record of what was sent is frozen. */
  function setResume(id, resumeId) {
    const list = all();
    const pkg = list.find(p => p.id === id);
    if (!pkg || pkg.status !== READY) return null;
    if (typeof ResumeRecommender === 'undefined') return pkg;

    const job = pkg.job;
    const rec = ResumeRecommender.recommend(job);
    /* picking the recommended résumé again simply clears the override */
    if (!resumeId || (rec && rec.id === resumeId)) ResumeRecommender.clearOverride(job.id);
    else ResumeRecommender.setOverride(job.id, resumeId);

    const resume = selectedResume(job);
    const letter = (typeof CoverLetter !== 'undefined') ? CoverLetter.regenerate(job) : null;

    pkg.resumeId = resume ? resume.id : null;
    pkg.resumeName = resume ? resume.name : null;
    if (letter) {
      pkg.coverLetter = letter.text;
      pkg.coverLetterResumeId = letter.resumeId;
    }
    pkg.updatedAt = Date.now();
    persist(list);
    return pkg;
  }

  /* the package must always show the résumé currently selected for its job
     (the job card can change it too) — rebuild if they have diverged */
  function syncToResume(id) {
    const pkg = get(id);
    if (!pkg || pkg.status !== READY) return pkg;
    const resume = selectedResume(pkg.job);
    const nowId = resume ? resume.id : null;
    if (pkg.resumeId === nowId) return pkg;
    return setResume(id, nowId);
  }

  /* ---------- mark as applied (explicit, user-driven) ---------- */

  function markApplied(id) {
    const list = all();
    const pkg = list.find(p => p.id === id);
    if (!pkg || pkg.status === APPLIED) return null;      // never applied twice
    pkg.status = APPLIED;
    pkg.appliedOn = today();
    pkg.appliedAt = Date.now();
    persist(list);
    return pkg;
  }

  function copyCoverLetter(id) {
    const pkg = get(id);
    if (!pkg || !pkg.coverLetter) return { ok: false, error: 'No cover letter in this package' };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(pkg.coverLetter);
        if (p && p.catch) p.catch(() => { /* denied over file:// — the text is still returned */ });
      } else if (typeof document !== 'undefined' && document.execCommand) {
        const ta = document.createElement('textarea');
        ta.value = pkg.coverLetter;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { /* clipboard is best-effort */ }
    return { ok: true, text: pkg.coverLetter };
  }

  /* remove a package that was never sent (used when an approval is undone) */
  function remove(jobId) {
    const list = all();
    const pkg = list.find(p => p.jobId === jobId);
    if (!pkg || pkg.status === APPLIED) return false;     // an applied package is a record — keep it
    persist(list.filter(p => p.jobId !== jobId));
    return true;
  }

  function clear() { persist([]); }

  return {
    STORAGE_KEY, READY, APPLIED, STATUS_LABEL,
    all, ready, get, forJob, has, statusLabel,
    createFrom, setResume, syncToResume, markApplied, copyCoverLetter, remove, clear,
  };
})();
