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
    return {
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
    add('Skills & certifications',
      jobSkills.length ? WEIGHTS.skills * matched.length / jobSkills.length : WEIGHTS.skills / 2,
      WEIGHTS.skills,
      jobSkills.length ? `${matched.length} of ${jobSkills.length} required skills on your profile` : 'Posting lists no skills',
      jobSkills.length > 0 && matched.length === 0);

    /* 2 — role fit vs target roles */
    const titleTok = tokens(job.title);
    const roleRatio = overlapRatio(titleTok, tokens(snap.targetRoles));
    add('Role fit', WEIGHTS.role * roleRatio, WEIGHTS.role,
      roleRatio >= 0.6 ? 'Title closely matches your target roles'
        : roleRatio > 0 ? 'Partial overlap with your target roles' : 'Outside your target roles',
      roleRatio === 0);

    /* 3 — experience relevance (employment history + master resume) */
    const histTitleRatio = overlapRatio(titleTok, snap.titleTokens);
    const histHits = jobSkills.filter(k => snap.historyText.includes(k.toLowerCase())).length;
    const expRatio = 0.5 * histTitleRatio + 0.5 * (jobSkills.length ? histHits / jobSkills.length : 0.5);
    add('Experience relevance', WEIGHTS.experience * expRatio, WEIGHTS.experience,
      `${histHits} posting keyword${histHits === 1 ? '' : 's'} appear in your work history${snap.master ? ' · master resume on file (read-only)' : ''}`,
      expRatio < 0.2);

    /* 4 — location & work mode (GCC-first regional rules) */
    const jloc = (job.location || '').toLowerCase();
    const remoteJob = job.workMode === 'Remote' || /remote/.test(jloc);
    const region = regionEval(job, snap, remoteJob, jloc);
    const modeOk = snap.workMode === 'Flexible' || job.workMode === snap.workMode;
    const locOk = remoteJob
      ? snap.locations.some(l => /remote/.test(l))
      : snap.locations.some(l => l && (jloc.includes(l.split(' ')[0]) || l.includes(jloc.split(' ')[0])));
    const locPts = region.filtered ? 2 : (modeOk ? 8 : 3) + (locOk ? 7 : (snap.relocation ? 4 : 1));
    add('Location & work mode', locPts, WEIGHTS.location, region.note,
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
    add('Salary alignment', salaryPts, WEIGHTS.salary, salaryNote, salaryBelow);

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
    return {
      score, factors, matched, missing,
      /* salary and region are independent hard filters */
      filtered: salaryBelow || region.filtered,
      filterReason: salaryBelow ? 'salary' : (region.filtered ? 'region' : null),
      region,
      reasons: factors.filter(f => !f.gap && f.points >= f.max * 0.6).map(f => f.note),
      gaps: factors.filter(f => f.gap).map(f => f.note),
    };
  }

  return { WEIGHTS, GCC_MODES, isGCC, evaluate, snapshotFromProfile, usdK, tokens };
})();
