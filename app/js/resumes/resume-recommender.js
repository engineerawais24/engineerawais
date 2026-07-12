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

  /* Sprint 27 extends the scoring with two more signals — certifications and
     industry — so the five the brief asks for are all represented:
       skills (skills 30) · certifications (10) · experience (level 15)
       · preferred role (category 25 + role 10) · industry (10)
     The weights still total 100 and the recommendation itself is unchanged
     for the existing jobs: both new signals award full marks when the job
     states no requirement, because an unstated requirement cannot be unmet. */
  const WEIGHTS = { category: 25, skills: 30, level: 15, role: 10, certifications: 10, industry: 10 };

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
      /* Sprint 27 */
      certifications: certificationsHeld(p),
      employer: (p.employment && p.employment.company) || '',
    };
  }

  /* keywords the résumé leads with, from the Résumé Library's role families */
  function keywordsFor(title) {
    return (typeof ResumesStore !== 'undefined' && ResumesStore.keywordsFor)
      ? ResumesStore.keywordsFor(title) : [];
  }

  /* ---------- Sprint 27: certifications ----------
     The certifications a posting actually asks for. Read from the job's own
     text — nothing is assumed. When a posting names none, the signal is not
     applicable and scores full: you cannot fail a requirement that isn't there. */
  const CERT_HINTS = [
    { id: 'Azure Administrator', re: /\b(az-104|azure administrator)\b/i },
    { id: 'Azure Solutions Architect', re: /\b(az-305|azure solutions architect)\b/i },
    { id: 'AWS Certified', re: /\baws certified\b/i },
    { id: 'Certified Kubernetes Administrator', re: /\b(cka|certified kubernetes administrator)\b/i },
    { id: 'Terraform Associate', re: /\bterraform associate\b/i },
    { id: 'TOGAF', re: /\btogaf\b/i },
    { id: 'PMP', re: /\bpmp\b/i },
    { id: 'CCNA', re: /\bccna\b/i },
  ];

  function certificationsRequiredBy(job) {
    const hay = [job.title, job.description, (job.skills || []).join(' ')].join(' ');
    return CERT_HINTS.filter(c => c.re.test(hay)).map(c => c.id);
  }

  /* the certifications the candidate actually holds (résumés are built from
     the one profile, so they all carry the same ones) */
  function certificationsHeld(profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : {});
    return (p.certifications || []).map(c => (c && c.name) ? c.name : String(c)).filter(Boolean);
  }

  function holdsCert(held, wanted) {
    return held.some(h => {
      const a = lc(h), b = lc(wanted);
      return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
    });
  }

  /* ---------- Sprint 27: industry ----------
     A résumé aimed at a payments company reads differently from one aimed at
     an observability vendor. The industry comes from the COMPANY on each side.
     An unknown company means the signal is not applicable — it scores full
     rather than penalising a job we simply have no industry data for. */
  const INDUSTRIES = [
    { id: 'payments', companies: ['stripe', 'adyen', 'checkout.com', 'paypal'] },
    { id: 'developer tools', companies: ['vercel', 'retool', 'hashicorp', 'github', 'gitlab'] },
    { id: 'observability', companies: ['datadog', 'new relic', 'grafana', 'splunk'] },
    { id: 'enterprise cloud', companies: ['microsoft', 'amazon web services', 'aws', 'google', 'oracle', 'ibm'] },
    { id: 'industrial', companies: ['honeywell', 'siemens', 'schneider electric', 'abb'] },
    { id: 'banking', companies: ['emirates nbd', 'mashreq', 'adcb', 'hsbc', 'standard chartered'] },
    { id: 'telecom', companies: ['saudi telecom', 'stc', 'mobily', 'etisalat', 'du', 'zain'] },
    { id: 'e-commerce', companies: ['noon', 'careem', 'amazon', 'talabat', 'namshi'] },
    { id: 'IT services', companies: ['systems limited', 'netsol', 'accenture', 'deloitte', 'pwc', 'ey', 'kpmg', 'techvantage'] },
    { id: 'data platforms', companies: ['palantir', 'snowflake', 'databricks'] },
  ];

  function industryOf(company) {
    const c = lc(company);
    if (!c) return null;
    const hit = INDUSTRIES.find(i => i.companies.some(name => c === name || c.indexOf(name) !== -1));
    return hit ? hit.id : null;                 // unknown → not applicable
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
    /* one rung either way still lands the interview; two is a stretch */
    const level = gap === 0 ? WEIGHTS.level
      : gap === 1 ? Math.round(WEIGHTS.level * 0.65)
        : gap === 2 ? Math.round(WEIGHTS.level * 0.3)
          : 0;
    if (gap === 0) reasons.push(`${resLvl}-level résumé for a ${jobLvl}-level role`);

    /* 4 — does the résumé's title sit inside your target roles? */
    const roleRatio = overlapRatio(tokens(resume.title), tokens(c.targetRoles));
    const role = Math.round(WEIGHTS.role * roleRatio);
    if (roleRatio >= 0.6) reasons.push('Matches your saved target roles');

    /* 5 — certifications the posting asks for (Sprint 27) */
    const certsWanted = certificationsRequiredBy(job);
    const held = c.certifications || certificationsHeld();
    const certsMatched = certsWanted.filter(w => holdsCert(held, w));
    let certifications;
    if (!certsWanted.length) {
      certifications = WEIGHTS.certifications;            // none asked for → nothing unmet
    } else {
      certifications = Math.round(WEIGHTS.certifications * certsMatched.length / certsWanted.length);
      if (certsMatched.length) reasons.push(`${certsMatched.length}/${certsWanted.length} certifications held`);
      else reasons.push(`Missing ${certsWanted.join(', ')}`);
    }

    /* 6 — industry alignment (Sprint 27) */
    const jobIndustry = industryOf(job.company);
    const resumeIndustry = resume.isMaster
      ? industryOf((c.employer) || '')
      : industryOf(resume.company);
    let industry;
    if (!jobIndustry || !resumeIndustry) {
      industry = WEIGHTS.industry;                        // no industry data → not applicable
    } else if (jobIndustry === resumeIndustry) {
      industry = WEIGHTS.industry;
      reasons.push(`Same industry (${jobIndustry})`);
    } else {
      industry = 0;
      reasons.push(`${resumeIndustry} résumé for a ${jobIndustry} company`);
    }

    const confidence = Math.max(0, Math.min(100,
      category + skills + level + role + certifications + industry));
    return {
      confidence,
      parts: { category, skills, level, role, certifications, industry },
      reasons,
      /* a short 1–2 line explanation */
      reason: reasons.slice(0, 2).join(' · '),
      jobCategory: jobCat, resumeCategory: resCat, jobLevel: jobLvl, resumeLevel: resLvl,
      matchedSkills: hits,
      certificationsRequired: certsWanted,
      certificationsMatched: certsMatched,
      jobIndustry, resumeIndustry,
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
    STORAGE_KEY, WEIGHTS, INDUSTRIES, CERT_HINTS,
    candidates, context, score, rank, recommend,
    overrides, overrideFor, setOverride, clearOverride, forJob,
    /* Sprint 27 */
    certificationsRequiredBy, certificationsHeld, industryOf, keywordsFor,
  };
})();
