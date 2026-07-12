/* ============================================================
   MatchEngine — the AI matching architecture (Sprint 8A).

   Pure and deterministic: evaluate(job, snapshot) → result.
   No DOM, no storage writes. The snapshot is a READ-ONLY view
   of the candidate built from the Profile and the uploaded
   master resume; the engine never mutates either. When the
   backend lands, the LLM replaces the factor heuristics but
   keeps this exact contract (score + factors + filtered).

   Result shape:
   {
     score:    0–100,
     factors:  [{ label, points, max, note, gap }]  — the "why",
     matched:  string[]   — job skills found on the profile,
     missing:  string[]   — job skills not on the profile,
     reasons:  string[]   — strongest positive notes,
     gaps:     string[]   — notes on weak factors,
     filtered: boolean    — true ONLY when a disclosed salary is
                            below the user's minimum (Salary Rules)
   }

   SALARY RULES (hard requirements):
   · disclosed salary ≥ preference  → keep
   · disclosed salary < preference  → filter out
   · missing / not disclosed / "Competitive" / "Negotiable" /
     "DOE" / similar                → NEVER filter
   ============================================================ */

const MatchEngine = (() => {

  /* factor weights — always sum to 100 */
  const WEIGHTS = {
    skills: 30, role: 20, experience: 15, location: 15,
    salary: 10, authorization: 5, languages: 5,
  };

  const USD_RATE = { USD: 1, AED: 0.2723, SAR: 0.2666, PKR: 0.0036, GBP: 1.27, EUR: 1.09 };

  /* GCC-first region rules: Saudi Arabia, UAE, Qatar, Bahrain,
     Kuwait, Oman — matched by country or major-city markers. */
  const GCC_MARKERS = [
    'saudi', 'riyadh', 'jeddah', 'dammam', 'khobar',        // Saudi Arabia
    'uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah', 'ajman',
    'qatar', 'doha',
    'bahrain', 'manama',
    'kuwait',
    'oman', 'muscat',
  ];

  function isGCC(location) {
    const l = String(location || '').toLowerCase();
    return GCC_MARKERS.some(m => l.includes(m));
  }

  const GCC_MODES = {
    REMOTE: 'Remote only',
    SPONSORED: 'Remote + relocation-sponsored',
    ALL: 'All work modes',
  };

  /* Regional work-mode rule:
     · GCC job              → on-site, hybrid, remote all allowed
     · non-GCC remote       → always allowed (labeled Remote)
     · non-GCC local        → allowed where you're already authorized
     · non-GCC on-site/hyb. → per outsideGccMode: needs explicit
       relocation support or visa sponsorship (default), everything
       (All work modes), or nothing (Remote only) */
  function regionEval(job, snap, remoteJob, jloc) {
    if (isGCC(job.location)) {
      return { gcc: true, filtered: false, includeReason: null,
        note: 'GCC role — on-site, hybrid and remote all allowed' };
    }
    if (remoteJob) {
      return { gcc: false, filtered: false, includeReason: 'Remote',
        note: 'Outside GCC — included because the role is remote' };
    }
    const local = snap.authorizedIn.some(c => c && jloc.includes(c))
      || (snap.homeCity && jloc.includes(snap.homeCity) && snap.authorizedIn.includes(snap.homeCountry));
    if (local) {
      return { gcc: false, filtered: false, includeReason: 'Local · authorized',
        note: 'Outside GCC — included because you\'re already authorized to work here' };
    }
    const mode = snap.outsideGccMode;
    if (mode === GCC_MODES.ALL) {
      return { gcc: false, filtered: false,
        includeReason: job.relocationSupport ? 'Relocation support' : job.visaSponsorship ? 'Visa sponsorship' : 'All work modes',
        note: 'Outside GCC — included by your “All work modes” setting' };
    }
    if (mode === GCC_MODES.REMOTE) {
      return { gcc: false, filtered: true, includeReason: null,
        note: 'Outside GCC and not remote — filtered by your “Remote only” setting' };
    }
    /* default: Remote + relocation-sponsored */
    if (job.relocationSupport) {
      return { gcc: false, filtered: false, includeReason: 'Relocation support',
        note: 'Outside GCC — included because relocation support is offered' };
    }
    if (job.visaSponsorship) {
      return { gcc: false, filtered: false, includeReason: 'Visa sponsorship',
        note: 'Outside GCC — included because the employer sponsors visas' };
    }
    return { gcc: false, filtered: true, includeReason: null,
      note: 'Outside GCC without relocation support or visa sponsorship — filtered by your work-mode setting' };
  }

  /* ---- Sprint 20: seniority + résumé-category signals ----
     Both are derived from the job title only, so evaluate() stays pure. */

  /* order matters: lead/staff wins over senior ("Senior Staff Engineer") */
  const LEVELS = [
    { id: 'entry', rank: 1, re: /\b(intern|junior|jr|graduate|entry|associate)\b/i },
    { id: 'lead', rank: 4, re: /\b(lead|staff|principal|head|director|manager|vp)\b/i },
    { id: 'senior', rank: 3, re: /\b(senior|sr)\b/i },
    { id: 'mid', rank: 2, re: null },      // fallback
  ];
  function levelOf(title) {
    const hit = LEVELS.find(l => l.re && l.re.test(String(title || '')));
    return hit ? hit.id : 'mid';
  }
  function levelRank(id) { const l = LEVELS.find(x => x.id === id); return l ? l.rank : 2; }

  /* the candidate's own level, from total years of experience */
  function levelFromYears(years) {
    if (years == null) return 'mid';
    if (years < 3) return 'entry';
    if (years < 6) return 'mid';
    if (years < 10) return 'senior';
    return 'lead';
  }

  /* résumé/role families — the same four the Résumé Library uses */
  const CATEGORIES = [
    { id: 'architect', re: /architect/i },
    { id: 'consultant', re: /consultant|advisor/i },
    { id: 'implementation', re: /implementation|deployment|deployed/i },
    { id: 'engineer', re: /engineer|developer|services/i },
    { id: 'general', re: null },           // fallback
  ];
  function categoryOf(title) {
    const hit = CATEGORIES.find(c => c.re && c.re.test(String(title || '')));
    return hit ? hit.id : 'general';
  }

  /* total professional experience from the saved employment history */
  function yearsFromProfile(p) {
    const dates = [];
    if (p.employment && p.employment.startDate) dates.push(p.employment.startDate);
    (p.history || []).forEach(h => { if (h && h.startDate) dates.push(h.startDate); });
    if (!dates.length) return null;
    const earliest = dates.slice().sort()[0];
    const [y, m] = String(earliest).split('-').map(Number);
    if (!y) return null;
    const now = new Date();
    const yrs = (now.getFullYear() - y) + ((now.getMonth() + 1) - (m || 1)) / 12;
    return Math.max(0, Math.round(yrs * 10) / 10);
  }

  const STOP = new Set(['and', 'the', 'for', 'with', 'of', 'to', 'a', 'an',
    'senior', 'staff', 'sr', 'jr', 'lead', 'principal', 'junior', 'ii', 'iii']);

  function tokens(str) {
    return new Set(String(str || '').toLowerCase().split(/[^a-z]+/)
      .filter(w => w.length > 2 && !STOP.has(w)));
  }

  function overlapRatio(jobTokens, mineTokens) {
    if (!jobTokens.size) return 0;
    let hit = 0;
    jobTokens.forEach(t => { if (mineTokens.has(t)) hit++; });
    return hit / jobTokens.size;
  }

  /* Effective annual salary in USD-thousands, or null when the
     job must never be filtered (undisclosed / text / unknown).
     Yearly salaries are stored in thousands; monthly-quoted roles
     (salaryPeriod:'month') are absolute per-month amounts. */
  function usdK(job) {
    if (!job.salaryDisclosed) return null;
    const s = job.salaryMax != null ? job.salaryMax : job.salary;
    if (s == null || typeof s !== 'number') return null;
    const annualK = job.salaryPeriod === 'month' ? (s * 12) / 1000 : s;
    return annualK * (USD_RATE[job.currency] || 1);
  }

  /* READ-ONLY view of the candidate. Built once per render from
     Profile.getState() and MasterResume.get(); nothing here can
     write back. The master resume contributes presence/metadata
     only until server-side parsing exists. */
  function snapshotFromProfile(p, master) {
    const norm = s => String(s || '').toLowerCase().trim();
    /* Sprint 20: the candidate's own seniority + résumé families */
    const years = yearsFromProfile(p);
    const roleTitles = [p.employment.title]
      .concat(String(p.preferences.targetRoles || '').split(',').map(s => s.trim()))
      .filter(Boolean);
    const categories = Array.from(new Set(roleTitles.map(categoryOf))).filter(c => c !== 'general');
    return {
      years,
      level: levelFromYears(years),
      categories,
      skills: p.skills.map(norm),
      certs: p.certifications.filter(c => c.name).map(c => norm(c.name)),
      languages: p.languages.filter(l => l.name).map(l => norm(l.name)),
      targetRoles: p.preferences.targetRoles,
      locations: p.preferences.locations.split(',')
        .map(s => norm(s).replace(/\(.*?\)/g, '').trim()).filter(Boolean),
      minSalaryK: Number(p.preferences.minSalary) || 0,
      monthlyMin: {
        SAR: Number(p.preferences.monthlyMinSAR) || 0,
        AED: Number(p.preferences.monthlyMinAED) || 0,
      },
      workMode: p.preferences.workMode,
      jobType: p.preferences.jobType,
      outsideGccMode: p.preferences.outsideGccMode || GCC_MODES.SPONSORED,
      relocation: !!p.preferences.relocation,
      authorizedIn: p.authorization.authorizedIn.split(',').map(norm).filter(Boolean),
      needsSponsorship: !!p.authorization.sponsorship,
      homeCity: norm(p.contact.city),
      homeCountry: norm(p.contact.country),
      historyText: [
        p.employment.title, p.employment.company, p.employment.highlights,
        ...p.history.flatMap(h => [h.title, h.company, h.highlights]),
      ].join(' ').toLowerCase(),
      titleTokens: tokens(p.employment.title + ' '
        + p.history.map(h => h.title).join(' ') + ' ' + p.preferences.targetRoles),
      master: master ? { name: master.name, locked: true } : null,
    };
  }

  function evaluate(job, snap) {
    const factors = [];
    const add = (label, points, max, note, gap = false) => {
      points = Math.max(0, Math.min(max, Math.round(points)));
      factors.push({ label, points, max, note, gap });
      return points;
    };

    /* 1 — skills & keywords (also honors certifications) */
    const jobSkills = job.skills || [];
    const matched = jobSkills.filter(s => {
      const k = s.toLowerCase();
      return snap.skills.some(ps => ps === k || ps.includes(k) || k.includes(ps))
          || snap.certs.some(c => c.includes(k));
    });
    const missing = jobSkills.filter(s => !matched.includes(s));
    const skillsPts = add('Skills & certifications',
      jobSkills.length ? WEIGHTS.skills * matched.length / jobSkills.length : WEIGHTS.skills / 2,
      WEIGHTS.skills,
      jobSkills.length ? `${matched.length} of ${jobSkills.length} required skills on your profile` : 'Posting lists no skills',
      jobSkills.length > 0 && matched.length === 0);

    /* 2 — role fit: target-role overlap (14) + résumé category (6) */
    const titleTok = tokens(job.title);
    const roleRatio = overlapRatio(titleTok, tokens(snap.targetRoles));
    const jobCategory = categoryOf(job.title);
    const myCategories = snap.categories || [];
    const catMatch = myCategories.indexOf(jobCategory) !== -1;
    const catPts = catMatch ? 6 : (jobCategory === 'general' || !myCategories.length) ? 3 : 1;
    add('Role fit', 14 * roleRatio + catPts, WEIGHTS.role,
      (roleRatio >= 0.6 ? 'Title closely matches your target roles'
        : roleRatio > 0 ? 'Partial overlap with your target roles' : 'Outside your target roles')
      + (catMatch ? ` · ${jobCategory} résumé category matched` : ''),
      roleRatio === 0 && !catMatch);

    /* 3 — experience: history relevance (9) + seniority-level fit (6) */
    const histTitleRatio = overlapRatio(titleTok, snap.titleTokens);
    const histHits = jobSkills.filter(k => snap.historyText.includes(k.toLowerCase())).length;
    const expRatio = 0.5 * histTitleRatio + 0.5 * (jobSkills.length ? histHits / jobSkills.length : 0.5);
    const jobLevel = levelOf(job.title);
    const myLevel = snap.level || 'mid';
    const levelGap = Math.abs(levelRank(jobLevel) - levelRank(myLevel));
    const levelPts = levelGap === 0 ? 6 : levelGap === 1 ? 4 : levelGap === 2 ? 2 : 0;
    const expPts = add('Experience relevance', 9 * expRatio + levelPts, WEIGHTS.experience,
      `${histHits} posting keyword${histHits === 1 ? '' : 's'} in your work history · ${jobLevel}-level role vs your ${myLevel} level`
      + (snap.years != null ? ` (~${snap.years} yrs)` : '') + (snap.master ? ' · master resume on file (read-only)' : ''),
      expRatio < 0.2 && levelPts <= 2);

    /* 4 — location & work mode: remote preference (8) + preferred location (7),
           inside the unchanged GCC-first regional rules */
    const jloc = (job.location || '').toLowerCase();
    const remoteJob = job.workMode === 'Remote' || /remote/.test(jloc);
    const region = regionEval(job, snap, remoteJob, jloc);
    const wantRemote = snap.workMode === 'Remote';
    const modeOk = snap.workMode === 'Flexible' || job.workMode === snap.workMode;
    let modePts;
    if (snap.workMode === 'Flexible') modePts = 6;
    else if (modeOk) modePts = 8;                                    // exact work-mode preference
    else if (wantRemote && job.workMode === 'Hybrid') modePts = 5;   // partial for remote-seekers
    else if (wantRemote && job.workMode === 'On-site') modePts = 2;
    else modePts = 3;
    const locOk = remoteJob
      ? snap.locations.some(l => /remote/.test(l))
      : snap.locations.some(l => l && (jloc.includes(l.split(' ')[0]) || l.includes(jloc.split(' ')[0])));
    const locPts = add('Location & work mode',
      region.filtered ? 2 : modePts + (locOk ? 7 : (snap.relocation ? 4 : 1)),
      WEIGHTS.location, region.note,
      region.filtered || (!modeOk && !locOk));

    /* 5 — salary alignment (the hard filter rules live here).
       Monthly-quoted roles compare against the user's local monthly
       threshold when one is configured for that currency; otherwise
       they annualize into the yearly USD comparison. */
    const k = usdK(job);
    const fmtN = n => Number(n).toLocaleString('en-US');
    let salaryBelow = false;
    let salaryNote;
    let salaryPts;
    const monthlyThr = job.salaryPeriod === 'month' ? (snap.monthlyMin[job.currency] || 0) : 0;
    if (k === null) {
      salaryPts = WEIGHTS.salary / 2;
      salaryNote = typeof job.salary === 'string'
        ? `“${job.salary}” — never filtered, per your salary rules`
        : 'Not disclosed — never filtered, per your salary rules';
    } else if (monthlyThr) {
      const v = job.salaryMax != null ? job.salaryMax : job.salary;
      if (v >= monthlyThr) {
        salaryPts = WEIGHTS.salary;
        salaryNote = `${job.currency} ${fmtN(v)}/mo meets your ${job.currency} ${fmtN(monthlyThr)}/mo minimum`;
      } else {
        salaryPts = 0;
        salaryBelow = true;
        salaryNote = `${job.currency} ${fmtN(v)}/mo is below your ${job.currency} ${fmtN(monthlyThr)}/mo minimum`;
      }
    } else if (k >= snap.minSalaryK) {
      salaryPts = WEIGHTS.salary;
      salaryNote = `≈$${Math.round(k)}k meets your $${snap.minSalaryK}k minimum`;
    } else {
      salaryPts = 0;
      salaryBelow = true;
      salaryNote = `≈$${Math.round(k)}k is below your $${snap.minSalaryK}k minimum`;
    }
    const salaryScore = add('Salary alignment', salaryPts, WEIGHTS.salary, salaryNote, salaryBelow);

    /* 6 — work authorization & visa. Job locations name cities, the
       authorization list names countries — so the user's own city
       counts as authorized ground when their country is on the list. */
    const authOk = remoteJob
      || snap.authorizedIn.some(c => c && jloc.includes(c))
      || (snap.homeCity && jloc.includes(snap.homeCity) && snap.authorizedIn.includes(snap.homeCountry));
    add('Authorization & visa',
      authOk ? WEIGHTS.authorization : job.visaSponsorship ? 4 : (snap.needsSponsorship ? 1 : 3),
      WEIGHTS.authorization,
      authOk ? (remoteJob ? 'Remote — no authorization barrier' : 'You\'re authorized to work here')
        : job.visaSponsorship ? 'Employer sponsors visas'
          : 'No sponsorship offered — you\'d need it here',
      !authOk && !job.visaSponsorship && snap.needsSponsorship);

    /* 7 — languages */
    const reqLangs = job.languagesRequired || [];
    const haveLangs = reqLangs.filter(r => snap.languages.includes(r.toLowerCase()));
    add('Languages',
      reqLangs.length ? WEIGHTS.languages * haveLangs.length / reqLangs.length : WEIGHTS.languages,
      WEIGHTS.languages,
      reqLangs.length ? `${haveLangs.length} of ${reqLangs.length} required languages (${reqLangs.join(', ')})` : 'No language requirement',
      reqLangs.length > 0 && haveLangs.length < reqLangs.length);

    const score = Math.max(0, Math.min(100, factors.reduce((n, f) => n + f.points, 0)));

    /* ---- Sprint 20: score breakdown + short match reasons ---- */
    const breakdown = {
      overall: score,
      skills: { points: skillsPts, max: WEIGHTS.skills },
      experience: { points: expPts, max: WEIGHTS.experience },
      location: { points: locPts, max: WEIGHTS.location },
      salary: { points: salaryScore, max: WEIGHTS.salary },
    };

    const matchReasons = [];
    if (skillsPts >= WEIGHTS.skills * 0.7) matchReasons.push('Strong skill match');
    else if (skillsPts >= WEIGHTS.skills * 0.4) matchReasons.push('Partial skill match');
    if (!region.filtered && (locOk || region.gcc)) matchReasons.push('Preferred location');
    if (salaryScore === WEIGHTS.salary) matchReasons.push('Salary meets expectation');
    if (wantRemote && remoteJob) matchReasons.push('Remote matches preference');
    if (catMatch) matchReasons.push('Resume category matched');
    if (levelPts >= 4) matchReasons.push('Experience level fits');
    if (roleRatio >= 0.6) matchReasons.push('Target role match');
    if (!authOk && job.visaSponsorship) matchReasons.push('Visa sponsorship offered');

    return {
      score, factors, matched, missing,
      /* salary and region are independent hard filters */
      filtered: salaryBelow || region.filtered,
      filterReason: salaryBelow ? 'salary' : (region.filtered ? 'region' : null),
      region,
      reasons: factors.filter(f => !f.gap && f.points >= f.max * 0.6).map(f => f.note),
      gaps: factors.filter(f => f.gap).map(f => f.note),
      /* Sprint 20 additions (purely additive — nothing above changed shape) */
      breakdown,
      matchReasons: matchReasons.slice(0, 5),
      jobLevel, jobCategory,
    };
  }

  return {
    WEIGHTS, GCC_MODES, isGCC, evaluate, snapshotFromProfile, usdK, tokens,
    /* Sprint 20 */
    levelOf, levelRank, levelFromYears, categoryOf, yearsFromProfile,
  };
})();
