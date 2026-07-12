/* ============================================================
   InterviewEngine — the interview preparation brain (Sprint 13
   PART 2, 3 & 5).

   Given an application's frozen memory (the exact submitted job,
   resume, cover letter and answers) plus the saved profile, it
   produces:

     prepPackage()   — job summary, company summary placeholder,
                       required vs missing skills, the exact
                       submitted documents, key achievements to
                       discuss and the risks needing preparation.
     questionGroups()— eight structured question groups, each answer
                       drawn ONLY from the submitted package, master
                       resume, profile or employment history.

   Every answer carries an interview-safety label (PART 5):
     safe    — traces verbatim to resume / submitted answer
     prep    — supported but rehearse the specifics
     blocked — no supporting evidence; Manual review required
   Nothing is invented.
   ============================================================ */

const InterviewEngine = (() => {

  const lc = s => String(s || '').toLowerCase();

  function masterOf(profile) {
    return (typeof TailorEngine !== 'undefined') ? TailorEngine.masterContent(profile) : { roles: [], skills: [], summarySentences: [] };
  }

  /* required vs missing (weaker) skills for the submitted job */
  function skillGap(memory, profile) {
    if (typeof TailorEngine === 'undefined') return { matched: [], missing: [] };
    const intel = TailorEngine.analyze(masterOf(profile), memory.job, profile);
    return { matched: intel.matched.slice(), missing: intel.missing.slice() };
  }

  /* find a resume/experience bullet that evidences a topic */
  function evidenceFor(topic, memory, profile) {
    const key = lc(topic);
    const master = masterOf(profile);
    for (const role of master.roles || []) {
      const hit = (role.bullets || []).find(b => lc(b).includes(key));
      if (hit) return { text: hit, source: `${role.company}${role.period ? ' · ' + role.period : ''}`, safety: 'safe' };
    }
    /* fall back to a supported submitted answer */
    const ans = (memory.submitted.answers || []).find(a => a.supported && lc(a.answer).includes(key));
    if (ans) return { text: ans.answer, source: `Submitted answer · ${ans.question}`, safety: 'prep' };
    return null;
  }

  const answerById = (memory, id) => (memory.submitted.answers || []).find(a => a.id === id) || null;

  function fromSubmittedAnswer(memory, id) {
    const a = answerById(memory, id);
    if (!a) return null;
    return {
      q: a.question,
      a: a.supported ? a.answer : '',
      safety: a.supported ? 'safe' : 'blocked',
      source: a.supported ? (a.source || 'Submitted application answer') : null,
      flag: a.supported ? null : (a.flag || 'Manual review required'),
      note: a.supported ? null : (a.note || 'Left for manual completion on the application.'),
    };
  }

  function skillQuestion(skill, memory, profile) {
    const ev = evidenceFor(skill, memory, profile);
    if (ev) return { q: `How have you used ${skill}?`, a: ev.text, safety: ev.safety, source: ev.source, flag: null };
    return {
      q: `The role asks for ${skill} — how would you get up to speed?`,
      a: '', safety: 'prep', source: null, flag: 'Manual review required',
      note: `No ${skill} experience is evidenced in your master resume — prepare an honest answer or a transferable-skills story.`,
    };
  }

  /* ---- PART 2: the interview preparation package ---- */
  function prepPackage(memory, profile) {
    const job = memory.job;
    const gap = skillGap(memory, profile);
    const doc = memory.submitted.resumeDoc;

    /* key achievements = submitted-resume bullets carrying a metric */
    const achievements = [];
    (doc.roles || []).forEach(role => {
      (role.bullets || []).forEach(b => {
        if (/\d/.test(b) && achievements.length < 6) {
          achievements.push({ text: b, source: `${role.company}${role.period ? ' · ' + role.period : ''}`, safety: 'safe' });
        }
      });
    });

    /* risks = missing skills + audit items needing prep + flagged answers */
    const risks = [];
    gap.missing.forEach(s => risks.push({ item: s, note: `Required skill "${s}" isn't evidenced in your master resume — prepare a gap story.`, safety: 'prep' }));
    (memory.submitted.audit || []).filter(x => x.status === 'prep' || x.status === 'blocked').forEach(x =>
      risks.push({ item: 'Resume bullet', note: `${x.note}`, safety: x.status === 'blocked' ? 'blocked' : 'prep' }));
    (memory.submitted.answers || []).filter(a => !a.supported).forEach(a =>
      risks.push({ item: 'Application answer', note: `"${a.question}" was left for manual completion.`, safety: 'prep' }));

    const tier = (typeof CompaniesStore !== 'undefined') ? CompaniesStore.tierOf(job.company) : 3;
    return {
      jobSummary: {
        title: job.title, company: job.company, location: job.location,
        workMode: job.workMode, employmentType: job.employmentType,
        source: job.source, url: memory.sourceUrl,
        description: job.description || '',
      },
      companySummary: {
        name: job.company, tier,
        tierLabel: tier === 1 ? 'Priority tier 1' : tier === 2 ? 'Priority tier 2' : 'Standard tier',
        placeholder: true,
        note: 'Company brief is a placeholder — add researched notes below. Priority tier comes from your Company ranking settings.',
      },
      requiredSkills: (job.skills || []).slice(),
      matchedSkills: gap.matched,
      missingSkills: gap.missing,
      submittedResume: doc,
      submittedCover: memory.submitted.coverLetter,
      submittedAnswers: memory.submitted.answers,
      achievements,
      risks,
    };
  }

  /* ---- PART 3: eight structured question groups ---- */
  function questionGroups(memory, profile) {
    const gap = skillGap(memory, profile);
    const stars = (typeof StarLibrary !== 'undefined') ? StarLibrary.build(profile, memory) : [];
    const starById = id => stars.find(s => s.id === id);
    const groups = [];

    const clean = arr => arr.filter(Boolean);

    /* 1 — Recruiter / HR */
    groups.push({
      id: 'hr', label: 'Recruiter / HR',
      questions: clean(['current_location', 'notice_period', 'work_authorization', 'visa_status', 'visa_sponsorship', 'relocation']
        .map(id => fromSubmittedAnswer(memory, id))),
    });

    /* 2 — Hiring manager */
    const hm = clean([fromSubmittedAnswer(memory, 'why_company'), fromSubmittedAnswer(memory, 'why_role')]);
    const topAch = (prepPackage(memory, profile).achievements[0]);
    if (topAch) hm.push({ q: 'What impact are you most proud of?', a: topAch.text, safety: 'safe', source: topAch.source });
    groups.push({ id: 'hiring_manager', label: 'Hiring manager', questions: hm });

    /* 3 — Technical */
    const tech = gap.matched.slice(0, 6).map(s => skillQuestion(s, memory, profile));
    gap.missing.slice(0, 3).forEach(s => tech.push(skillQuestion(s, memory, profile)));
    groups.push({ id: 'technical', label: 'Technical', questions: tech });

    /* 4 — Delivery & stakeholder */
    groups.push({ id: 'delivery', label: 'Delivery & stakeholder', questions: starQuestions(['stakeholder', 'handover', 'vendor'], starById) });

    /* 5 — Leadership */
    groups.push({ id: 'leadership', label: 'Leadership', questions: starQuestions(['leadership', 'stc_ops', 'g20_hajj'], starById) });

    /* 6 — Behavioral / STAR */
    groups.push({ id: 'behavioral', label: 'Behavioral / STAR', questions: starQuestions(['incident', 'risk', 'troubleshooting', 'zatca_psim'], starById) });

    /* 7 — Salary & notice period */
    groups.push({
      id: 'salary', label: 'Salary & notice period',
      questions: clean([fromSubmittedAnswer(memory, 'salary_expectation'), fromSubmittedAnswer(memory, 'notice_period')]),
    });

    /* 8 — Resume-specific (the EXACT submitted version) */
    const rs = [];
    (memory.submitted.resumeDoc.roles || []).forEach(role => {
      const bullets = (role.bullets || []).filter(Boolean);
      if (!role.company || !bullets.length) return;
      rs.push({
        q: `Walk me through your work at ${role.company}${role.title ? ` as ${role.title}` : ''}.`,
        a: bullets.join(' '), safety: 'safe',
        source: `Submitted resume · ${role.company}${role.period ? ' · ' + role.period : ''}`,
      });
    });
    (memory.submitted.audit || []).filter(x => x.status !== 'safe').forEach(x => rs.push({
      q: `Be ready to explain: "${String(x.text).slice(0, 80)}${x.text.length > 80 ? '…' : ''}"`,
      a: '', safety: x.status === 'blocked' ? 'blocked' : 'prep',
      source: x.source, flag: x.status === 'blocked' ? 'Manual review required' : null, note: x.note,
    }));
    groups.push({ id: 'resume_specific', label: 'Resume-specific', questions: rs });

    return groups;
  }

  function starQuestions(ids, starById) {
    return ids.map(id => {
      const s = starById(id);
      if (!s) return null;
      if (s.safety === 'blocked') {
        return { q: `Tell me about a time involving ${s.theme.toLowerCase()}.`, a: '', safety: 'blocked', flag: s.flag, note: s.note, source: null };
      }
      return {
        q: `Tell me about a time involving ${s.theme.toLowerCase()}.`,
        a: `S: ${s.situation}. T: ${s.task}. A: ${s.action} R: ${s.result}`,
        safety: s.safety, source: s.source, flag: s.flag || null, note: s.note,
      };
    }).filter(Boolean);
  }

  /* safety rollup for the overview */
  function safetyRollup(memory, profile) {
    const groups = questionGroups(memory, profile);
    let safe = 0, prep = 0, blocked = 0, total = 0;
    groups.forEach(g => g.questions.forEach(q => {
      total++;
      if (q.safety === 'safe') safe++; else if (q.safety === 'blocked') blocked++; else prep++;
    }));
    return { total, safe, prep, blocked, groups: groups.length };
  }

  return { prepPackage, questionGroups, safetyRollup, skillGap, evidenceFor };
})();
