/* ============================================================
   Interview — the Interview Copilot controller (Sprint 13).

   Owns the page's UI state (selected application, active section
   tab, mock mode) and every action. Persistence is delegated to
   ApplicationMemory; generation to InterviewEngine / StarLibrary /
   MockInterview; rendering to InterviewView.

   Free-text fields persist on `onchange` (fires on blur) WITHOUT a
   re-render, so typing never loses focus; navigation actions
   (tab / next / status / save) re-render.
   ============================================================ */

const Interview = (() => {

  const ui = { selectedId: null, tab: 'overview', mode: 'technical' };

  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function' && currentRoute() === 'interview') navigate();
  }

  function selected(list) {
    if (!list.length) return null;
    let rec = ui.selectedId ? ApplicationMemory.get(ui.selectedId) : null;
    if (!rec) rec = list[0];
    ui.selectedId = rec.jobId;
    return rec;
  }

  function render() {
    ApplicationMemory.syncFromSubmissions();          // lazily freeze any new submissions
    const list = ApplicationMemory.all();
    const rec = selected(list);
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : {};
    return InterviewView.screen(list, rec, profile, ui);
  }

  /* ---- navigation ---- */
  function select(jobId) { ui.selectedId = jobId; ui.tab = 'overview'; refresh(); }
  function tab(name) { ui.tab = name; refresh(); }
  function setMode(mode) { ui.mode = mode; refresh(); }

  /* ---- interview workflow + tracker (PART 7) ---- */
  function setStatus(jobId, status) {
    ApplicationMemory.setStatus(jobId, status);
    if (typeof toast === 'function') toast(`Status → ${ApplicationMemory.statusLabel(status)}`);
    refresh();
  }
  function saveTracker(jobId) {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    ApplicationMemory.update(jobId, {
      interview: {
        date: v('iv-idate'), type: v('iv-itype'),
        interviewer: v('iv-interviewer'), meetingLink: v('iv-link'),
      },
      followUpDate: v('iv-followup'),
      recruiterNotes: v('iv-recruiter'),
      notes: v('iv-notes'),
    });
    if (typeof toast === 'function') toast('Interview details saved');
    refresh();
  }

  /* ---- mock interview (PART 6) ---- */
  function session(jobId) {
    const rec = ApplicationMemory.get(jobId);
    if (!rec) return null;
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : {};
    return { rec, profile, s: MockInterview.ensure(rec, profile, ui.mode) };
  }
  /* silent persistence — no re-render (keeps textarea focus) */
  function mockAnswer(jobId, i, text) {
    const ctx = session(jobId); if (!ctx) return;
    MockInterview.setAnswer(ctx.s, i, text);
    ApplicationMemory.saveMock(jobId, ui.mode, ctx.s);
  }
  function mockNote(jobId, i, text) {
    const ctx = session(jobId); if (!ctx) return;
    MockInterview.setNote(ctx.s, i, text);
    ApplicationMemory.saveMock(jobId, ui.mode, ctx.s);
  }
  function mockRate(jobId, i, val) {
    const ctx = session(jobId); if (!ctx) return;
    MockInterview.setRating(ctx.s, i, val);
    ApplicationMemory.saveMock(jobId, ui.mode, ctx.s);
    refresh();
  }
  function mockNext(jobId) {
    const ctx = session(jobId); if (!ctx) return;
    MockInterview.next(ctx.s);
    ApplicationMemory.saveMock(jobId, ui.mode, ctx.s);
    refresh();
  }
  function mockPrev(jobId) {
    const ctx = session(jobId); if (!ctx) return;
    MockInterview.prev(ctx.s);
    ApplicationMemory.saveMock(jobId, ui.mode, ctx.s);
    refresh();
  }
  function mockRestart(jobId) {
    const rec = ApplicationMemory.get(jobId); if (!rec) return;
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : {};
    ApplicationMemory.saveMock(jobId, ui.mode, MockInterview.newSession(rec, profile, ui.mode));
    if (typeof toast === 'function') toast('Mock session restarted');
    refresh();
  }

  return {
    render, select, tab, setMode, setStatus, saveTracker,
    mockAnswer, mockNote, mockRate, mockNext, mockPrev, mockRestart,
  };
})();
