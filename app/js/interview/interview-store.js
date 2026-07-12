/* ============================================================
   ApplicationMemory — permanent per-application memory + the
   interview workflow (Sprint 13 PART 1 & 7).

   Once an application is SUBMITTED (Sprint 12), its exact
   submitted version is frozen here forever and NEVER silently
   replaced. The record has two halves:

     • submitted{}  — IMMUTABLE. The exact resume, cover letter,
       answers, safety audit and job record that were sent. Once
       captured it is never rewritten (re-capturing is a no-op).

     • the mutable interview tracker — status, interview date/type/
       interviewer/meeting link, recruiter notes, follow-up date,
       and the saved mock-interview sessions.

   Memory is captured LAZILY from SubmissionStore (syncFromSubmissions)
   the first time the Interview page reads it — nothing in the
   Sprint 12 submission path is modified, so the submission gates
   are untouched. Answers + cover letter come from the submission
   SNAPSHOT (exact); the renderable resume document is derived once
   from the package's frozen plan and then frozen here too.
   ============================================================ */

const ApplicationMemory = (() => {

  const KEY = 'careerpilot_appmemory_v1';

  /* interview workflow states (PART 7). `submitted` is the pre-
     interview entry state; the rest are the interview lifecycle. */
  const STATES = [
    { id: 'submitted',            label: 'Submitted' },
    { id: 'interview_invited',    label: 'Interview Invited' },
    { id: 'interview_scheduled',  label: 'Interview Scheduled' },
    { id: 'interview_completed',  label: 'Interview Completed' },
    { id: 'followup_due',         label: 'Follow-up Due' },
    { id: 'next_round',           label: 'Next Round' },
    { id: 'offer',                label: 'Offer' },
    { id: 'rejected',             label: 'Rejected' },
  ];
  const INTERVIEW_TYPES = ['Recruiter / HR', 'Hiring manager', 'Technical', 'Panel', 'Final round'];

  function statusLabel(id) {
    const s = STATES.find(x => x.id === id);
    return s ? s.label : id;
  }
  function isKnownState(id) { return STATES.some(s => s.id === id); }

  /* ---- storage ---- */
  function load() {
    const base = { records: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.records === 'object' && saved.records) base.records = saved.records;
    } catch (e) { /* corrupt → empty */ }
    return base;
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function all() {
    return Object.values(load().records).sort((a, b) => (b.dateApplied || 0) - (a.dateApplied || 0));
  }
  function get(jobId) { return load().records[jobId] || null; }
  function put(rec) {
    if (!rec || !rec.jobId) return false;
    rec.updatedAt = Date.now();
    const state = load();
    state.records[rec.jobId] = rec;
    return save(state);
  }
  function remove(jobId) { const s = load(); delete s.records[jobId]; return save(s); }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

  const clone = v => JSON.parse(JSON.stringify(v));

  /* build a SELF-CONTAINED renderable resume document from the
     package's frozen plan — literal strings only, so it renders
     the exact submitted resume independent of any later profile
     edits (the plan.ops arrays already hold the actual content). */
  function buildResumeDoc(profile, pkg) {
    const r = pkg.resume || {};
    const plan = r.plan;
    const p = profile || {};
    const name = `${(p.personal && p.personal.firstName) || ''} ${(p.personal && p.personal.lastName) || ''}`.trim();
    const contact = p.contact
      ? [p.contact.email, p.contact.phone, [p.contact.city, p.contact.country].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ')
      : '';
    if (!plan || !plan.ops) {
      /* degraded fallback when the package plan is unavailable */
      return { name, contact, summary: '', skills: (r.matched || []).slice(), certifications: [], roles: [], degraded: true };
    }
    const master = (typeof TailorEngine !== 'undefined') ? TailorEngine.masterContent(p) : { roles: [] };
    return {
      name, contact,
      summary: plan.ops.summaryText || '',
      skills: (plan.ops.skills || []).slice(),
      certifications: (plan.ops.certs || []).slice(),
      roles: (plan.ops.roles || []).map((ro, i) => ({
        title: master.roles[i] ? master.roles[i].title : '',
        company: master.roles[i] ? master.roles[i].company : '',
        period: master.roles[i] ? master.roles[i].period : '',
        bullets: (ro.order || []).slice(),
      })),
    };
  }

  /* freeze the exact submitted application into permanent memory.
     Never overwrites an existing `submitted` block. Returns the
     record (existing or newly created). */
  function captureFromSubmission(pkg, subRec, profile) {
    if (!pkg || !subRec || !pkg.jobId) return null;
    const existing = get(pkg.jobId);
    if (existing && existing.submitted) return existing;   // immutable — never replace

    const snap = subRec.snapshot || {};
    const job = clone(pkg.job);
    const rec = {
      id: 'mem-' + pkg.jobId,
      jobId: pkg.jobId,
      submissionId: subRec.confirmationId || null,
      capturedAt: Date.now(),

      /* permanent facts (PART 1) */
      company: job.company,
      role: job.title,
      jobDescription: job.description || '',
      sourceUrl: snap.sourceUrl || pkg.sourceUrl || job.applyUrl || '',
      dateApplied: subRec.submittedAt || Date.now(),
      matchScore: pkg.matchScore != null ? pkg.matchScore : null,
      resumeSafety: (snap.resumeSafety != null) ? snap.resumeSafety
        : (pkg.resume && pkg.resume.safety ? pkg.resume.safety.score : null),
      job: job,
      requiredSkills: (job.skills || []).slice(),
      preferredSkills: (job.preferredSkills || []).slice(),

      /* the EXACT submitted version — immutable */
      submitted: {
        resumeDoc: buildResumeDoc(profile, pkg),
        resumeMeta: {
          label: (snap.resume && snap.resume.label) || (pkg.resume && pkg.resume.label) || 'Tailored copy',
          base: (snap.resume && snap.resume.base) || (pkg.resume && pkg.resume.base) || '',
          safety: (snap.resumeSafety != null) ? snap.resumeSafety : (pkg.resume && pkg.resume.safety ? pkg.resume.safety.score : null),
          changes: (pkg.resume && pkg.resume.plan) ? (pkg.resume.plan.changes || []).length : 0,
          matched: (pkg.resume && pkg.resume.matched ? pkg.resume.matched : []).slice(),
        },
        coverLetter: snap.coverLetter != null ? snap.coverLetter : (pkg.coverLetter || ''),
        answers: clone(snap.answers && snap.answers.length ? snap.answers : (pkg.answers || [])),
        audit: clone((pkg.resume && pkg.resume.audit) || []),
        interviewConfidence: (pkg.resume && pkg.resume.interviewConfidence) || null,
      },

      /* mutable interview tracker (PART 1 + PART 7) */
      status: 'submitted',
      interview: { date: '', type: '', interviewer: '', meetingLink: '' },
      recruiterNotes: '',
      followUpDate: '',
      notes: '',
      events: [{ status: 'submitted', at: Date.now() }],
      mock: { technical: null, hr: null },
    };
    put(rec);
    return rec;
  }

  /* idempotent: ensure every SUBMITTED application has a memory
     record. Reads the current package for the renderable resume;
     once captured, the frozen `submitted` block never changes. */
  function syncFromSubmissions() {
    if (typeof SubmissionStore === 'undefined') return [];
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : null;
    SubmissionStore.all()
      .filter(r => r.status === 'submitted')
      .forEach(r => {
        if (get(r.jobId)) return;
        const pkg = (typeof PrepStore !== 'undefined') ? PrepStore.get(r.jobId) : null;
        if (pkg) captureFromSubmission(pkg, r, profile);
      });
    return all();
  }

  /* ---- mutable updates (never touch `submitted`) ---- */
  function update(jobId, patch) {
    const rec = get(jobId);
    if (!rec) return null;
    ['recruiterNotes', 'followUpDate', 'notes'].forEach(k => { if (k in patch) rec[k] = patch[k]; });
    if (patch.interview) rec.interview = Object.assign({}, rec.interview, patch.interview);
    put(rec);
    return rec;
  }
  function setStatus(jobId, status) {
    const rec = get(jobId);
    if (!rec || !isKnownState(status)) return null;
    rec.status = status;
    rec.events.push({ status, at: Date.now() });
    put(rec);
    return rec;
  }
  function saveMock(jobId, mode, session) {
    const rec = get(jobId);
    if (!rec) return null;
    rec.mock = rec.mock || { technical: null, hr: null };
    rec.mock[mode] = session;
    put(rec);
    return rec;
  }

  return {
    KEY, STATES, INTERVIEW_TYPES, statusLabel, isKnownState,
    load, save, all, get, put, remove, clear,
    buildResumeDoc, captureFromSubmission, syncFromSubmissions,
    update, setStatus, saveMock,
  };
})();
