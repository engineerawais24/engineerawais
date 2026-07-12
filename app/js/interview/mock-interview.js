/* ============================================================
   MockInterview — mock interview mode (Sprint 13 PART 6).

   Two modes, Technical and HR, each a running session of
   questions drawn from InterviewEngine's groups for the exact
   submitted application. Every card exposes: the question, a user
   answer field, the suggested (traceable) answer, the key points
   expected, a confidence rating, improvement notes, and a next
   control. Session state (answers, ratings, notes, position) is
   persisted per application via ApplicationMemory so it survives
   reloads.

   Suggested answers and key points come only from the submitted
   package / resume / profile — never invented. Blocked questions
   carry no suggestion and are flagged for manual preparation.
   ============================================================ */

const MockInterview = (() => {

  const MODES = [
    { id: 'technical', label: 'Technical', groups: ['technical', 'resume_specific', 'delivery'] },
    { id: 'hr',        label: 'HR / Recruiter', groups: ['hr', 'hiring_manager', 'salary', 'behavioral'] },
  ];

  function modeDef(mode) { return MODES.find(m => m.id === mode) || MODES[0]; }

  /* expected key points = traceable fragments of the suggested answer */
  function keyPoints(suggested) {
    if (!suggested) return [];
    return String(suggested)
      .split(/(?<=[.!?])\s+|(?:^|\s)(?=[STAR]:\s)/)
      .map(s => s.trim())
      .filter(s => s.length > 3)
      .slice(0, 4);
  }

  function questionsForMode(memory, profile, mode) {
    const groups = (typeof InterviewEngine !== 'undefined') ? InterviewEngine.questionGroups(memory, profile) : [];
    const wanted = modeDef(mode).groups;
    const out = [];
    groups.filter(g => wanted.includes(g.id)).forEach(g => {
      g.questions.forEach(q => out.push({
        q: q.q,
        suggested: q.a || '',
        keyPoints: keyPoints(q.a),
        safety: q.safety,
        source: q.source || null,
        flag: q.flag || null,
        category: g.label,
      }));
    });
    return out;
  }

  function newSession(memory, profile, mode) {
    return {
      mode, startedAt: Date.now(), updatedAt: Date.now(),
      questions: questionsForMode(memory, profile, mode),
      index: 0, answers: {}, ratings: {}, notes: {},
    };
  }

  /* return the saved session for a mode, or a fresh one. The saved
     session's questions are kept so answers stay aligned to indices. */
  function ensure(memory, profile, mode) {
    const saved = memory.mock && memory.mock[mode];
    if (saved && Array.isArray(saved.questions) && saved.questions.length) return saved;
    return newSession(memory, profile, mode);
  }

  /* pure session mutators (controller persists via ApplicationMemory) */
  function setAnswer(session, i, text) { session.answers[i] = text; session.updatedAt = Date.now(); return session; }
  function setRating(session, i, val) { session.ratings[i] = Math.max(1, Math.min(5, Number(val) || 0)); session.updatedAt = Date.now(); return session; }
  function setNote(session, i, text) { session.notes[i] = text; session.updatedAt = Date.now(); return session; }
  function goto(session, i) {
    session.index = Math.max(0, Math.min(session.questions.length - 1, Number(i) || 0));
    session.updatedAt = Date.now();
    return session;
  }
  function next(session) { return goto(session, session.index + 1); }
  function prev(session) { return goto(session, session.index - 1); }

  function progress(session) {
    const answered = Object.keys(session.answers || {}).filter(k => String(session.answers[k] || '').trim()).length;
    return { answered, total: session.questions.length };
  }

  return { MODES, modeDef, questionsForMode, newSession, ensure, keyPoints, setAnswer, setRating, setNote, goto, next, prev, progress };
})();
