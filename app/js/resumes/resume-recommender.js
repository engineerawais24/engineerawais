/* ============================================================
   ResumeRecommender — picks the best résumé for a job (Sprint 21).

   Pure and deterministic: score(resume, job, ctx) → confidence.
   No DOM. It only READS the Résumé Library variants, the profile and
   the job; it never modifies a résumé, the locked master, or any
   existing decision. The master résumé stays read-only.

   Signals (weights sum to 100):
     category 35 — the résumé's role family vs the job's
     skills   35 — the résumé's keywords vs the job's required skills
     level    20 — the résumé's seniority vs the job's
     role     10 — the résumé's title vs your saved target roles

   Category and level reuse MatchEngine.categoryOf / levelOf (Sprint
   20), so the board and the recommender always agree.

   A manual override (per job) is persisted through the existing
   AppStorage platform abstraction — no new storage system.
   ============================================================ */

const ResumeRecommender = (() => {

  const STORAGE_KEY = 'resume_overrides';
  const WEIGHTS = { category: 35, skills: 35, level: 20, role: 10 };

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  function tokens(s) {
    return (typeof MatchEngine !== 'undefined' && MatchEngine.tokens)
      ? MatchEngine.tokens(s)
      : new Set(lc(s).split(/[^a-z]+/).filter(w => w.length > 2));
  }
  function overlapRatio(a, b) {
    if (!a.size) return 0;
    let hit = 0;
    a.forEach(t => { if (b.has(t)) hit++; });
    return hit / a.size;
  }
  const categoryOf = t => (typeof MatchEngine !== 'undefined' ? MatchEngine.categoryOf(t) : 'general');
  const levelOf = t => (typeof MatchEngine !== 'undefined' ? MatchEngine.levelOf(t) : 'mid');
  const levelRank = id => (typeof MatchEngine !== 'undefined' ? MatchEngine.levelRank(id) : 2);

  /* ---------- candidates: the locked master + every tailored variant ---------- */
  function candidates() {
    const list = [];
    const p = (typeof Profile !== 'undefined') ? Profile.getState() : null;
    const file = (typeof MasterResume !== 'undefined') ? MasterResume.get() : null;
    const masterTitle = (p && p.employment && p.employment.title) || (p && p.personal && p.personal.headline) || '';
    list.push({
      id: 'master',
      name: file ? file.name : 'Master résumé',
      title: masterTitle,
      company: null,
      isMaster: true,
    });
    const docs = (typeof ResumesStore !== 'undefined') ? (ResumesStore.load().variants || []) : [];
    docs.forEach(v => list.push({
      id: v.id,
      name: `${v.company} — ${v.title}`,
      title: v.title,
      company: v.company,
      ats: v.ats,
      isMaster: false,
    }));
    return list;
  }

  function context() {
    const p = (typeof Profile !== 'undefined') ? Profile.getState() : { preferences: {}, skills: [] };
    const years = (typeof MatchEngine !== 'undefined' && MatchEngine.yearsFromProfile)
      ? MatchEngine.yearsFromProfile(p) : null;
    return {
      targetRoles: (p.preferences && p.preferences.targetRoles) || '',
      level: (typeof MatchEngine !== 'undefined' && MatchEngine.levelFromYears)
        ? MatchEngine.levelFromYears(years) : 'mid',
      years,
    };
  }

  /* keywords the résumé leads with, from the Résumé Library's role families */
  function keywordsFor(title) {
    return (typeof ResumesStore !== 'undefined' && ResumesStore.keywordsFor)
      ? ResumesStore.keywordsFor(title) : [];
  }

  /* ---------- scoring ---------- */
  function score(resume, job, ctx) {
    const c = ctx || context();
    const reasons = [];

    /* 1 — résumé category vs the job's family */
    const jobCat = categoryOf(job.title);
    const resCat = resume.isMaster ? 'general' : categoryOf(resume.title);
    let category;
    if (resCat === jobCat && jobCat !== 'general') { category = WEIGHTS.category; reasons.push(`${resCat} résumé matches this ${jobCat} role`); }
    else if (resCat === 'general' || jobCat === 'general') { category = Math.round(WEIGHTS.category * 0.5); reasons.push('General-purpose résumé for this role'); }
    else { category = Math.round(WEIGHTS.category * 0.17); reasons.push(`${resCat} résumé — this is a ${jobCat} role`); }

    /* 2 — the résumé's keywords vs the job's required skills */
    const kws = keywordsFor(resume.isMaster ? (c.targetRoles || resume.title) : resume.title);
    const jobSkills = job.skills || [];
    const hits = jobSkills.filter(s => kws.some(k => {
      const a = lc(k), b = lc(s);
      return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
    }));
    const skills = jobSkills.length
      ? Math.round(WEIGHTS.skills * hits.length / jobSkills.length)
      : Math.round(WEIGHTS.skills * 0.5);
    if (jobSkills.length) reasons.push(`${hits.length}/${jobSkills.length} required skills covered`);

    /* 3 — seniority alignment */
    const jobLvl = levelOf(job.title);
    const resLvl = resume.isMaster ? (c.level || 'mid') : levelOf(resume.title);
    const gap = Math.abs(levelRank(jobLvl) - levelRank(resLvl));
    const level = gap === 0 ? WEIGHTS.level : gap === 1 ? 13 : gap === 2 ? 6 : 0;
    if (gap === 0) reasons.push(`${resLvl}-level résumé for a ${jobLvl}-level role`);

    /* 4 — does the résumé's title sit inside your target roles? */
    const roleRatio = overlapRatio(tokens(resume.title), tokens(c.targetRoles));
    const role = Math.round(WEIGHTS.role * roleRatio);
    if (roleRatio >= 0.6) reasons.push('Matches your saved target roles');

    const confidence = Math.max(0, Math.min(100, category + skills + level + role));
    return {
      confidence,
      parts: { category, skills, level, role },
      reasons,
      /* a short 1–2 line explanation */
      reason: reasons.slice(0, 2).join(' · '),
      jobCategory: jobCat, resumeCategory: resCat, jobLevel: jobLvl, resumeLevel: resLvl,
      matchedSkills: hits,
    };
  }

  /* every candidate, best first (deterministic tie-break on id) */
  function rank(job, ctx) {
    const c = ctx || context();
    return candidates()
      .map(r => Object.assign({}, r, score(r, job, c)))
      .sort((a, b) => (b.confidence - a.confidence) || String(a.id).localeCompare(String(b.id)));
  }

  function recommend(job, ctx) {
    const list = rank(job, ctx);
    return list.length ? list[0] : null;
  }

  /* ---------- manual override (persisted via AppStorage) ---------- */
  function overrides() {
    const o = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    return (o && typeof o === 'object') ? o : {};
  }
  function overrideFor(jobId) { return overrides()[jobId] || null; }
  function setOverride(jobId, resumeId) {
    const o = overrides();
    if (!resumeId) { delete o[jobId]; }
    else { o[jobId] = resumeId; }
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, o);
    return o[jobId] || null;
  }
  function clearOverride(jobId) { return setOverride(jobId, null); }

  /* what the card should show: the recommendation, the active choice
     (override wins), and every option — all scored for this job. */
  function forJob(job) {
    const ctx = context();
    const all = rank(job, ctx);
    if (!all.length) return null;
    const recommended = all[0];
    const chosenId = overrideFor(job.id);
    const chosen = chosenId ? all.find(r => r.id === chosenId) : null;
    return {
      recommended,
      selected: chosen || recommended,
      overridden: !!chosen,
      all,
    };
  }

  return {
    STORAGE_KEY, WEIGHTS,
    candidates, context, score, rank, recommend,
    overrides, overrideFor, setOverride, clearOverride, forJob,
  };
})();
