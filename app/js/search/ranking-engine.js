/* ============================================================
   SearchRanking — explainable job relevance scoring (Sprint 18
   PART 5).

   Scores every UnifiedJob 0–100 for the SEARCH RESULT LIST only.
   It is ADDITIVE: it does NOT replace or weaken MatchEngine,
   DecisionEngine, the GCC work-mode rules, the salary rules or the
   company ranking — those still govern the approval workflow
   exactly as before. This score only orders and explains results.

   DETERMINISTIC BY CONSTRUCTION
     • no randomness, no Date.now() anywhere in the scoring path
     • the same (job, context) always yields the same score
     • every point is attributable to a named component → reasons[]

   Weights (sum = 100):
     skills 25 · salary 12 · location 12 · title 12 · resume 10
     experience 8 · remote 6 · certifications 5 · seniority 4
     employmentType 2 · visa 2 · keywords 2
   Excluded keywords and prior REJECT decisions apply penalties.
   Prior APPROVE decisions apply a bounded bonus. User decisions are
   READ ONLY — ranking never writes or overwrites them.
   ============================================================ */

const SearchRanking = (() => {

  const VERSION = 'sr-1';           // part of the cache key (PART 7)

  const WEIGHTS = {
    skills: 25, salary: 12, location: 12, title: 12, resume: 10,
    experience: 8, remote: 6, certifications: 5, seniority: 4,
    employmentType: 2, visa: 2, keywords: 2,
  };
  const HISTORY_BONUS = 6;
  const HISTORY_PENALTY = 10;
  const EXCLUDED_PENALTY = 25;

  const lc = s => String(s == null ? '' : s).toLowerCase();
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const uniq = a => Array.from(new Set(a));

  const SENIOR_WORDS = ['staff', 'principal', 'lead', 'senior', 'sr', 'head', 'director', 'manager'];
  const JUNIOR_WORDS = ['junior', 'jr', 'intern', 'graduate', 'entry', 'associate'];

  function tokens(s) { return uniq(lc(s).split(/[^a-z0-9+#.]+/).filter(Boolean)); }

  function skillHit(profileSkills, jobSkill) {
    const k = lc(jobSkill);
    return profileSkills.some(p => { const s = lc(p); return s === k || s.indexOf(k) !== -1 || k.indexOf(s) !== -1; });
  }

  /* total professional experience from the saved employment history */
  function yearsOfExperience(p) {
    const dates = [];
    if (p.employment && p.employment.startDate) dates.push(p.employment.startDate);
    (p.history || []).forEach(h => { if (h && h.startDate) dates.push(h.startDate); });
    if (!dates.length) return null;
    const earliest = dates.slice().sort()[0];
    const [y, m] = String(earliest).split('-').map(Number);
    if (!y) return null;
    /* reference date is the job's postedAt when available so the score
       stays deterministic; falls back to the profile's own baseline. */
    return { startYear: y, startMonth: m || 1 };
  }
  function experienceYearsAt(p, referenceIso) {
    const s = yearsOfExperience(p);
    if (!s) return null;
    const ref = referenceIso ? new Date(referenceIso) : new Date('2026-07-01T00:00:00Z');
    if (isNaN(ref.getTime())) return null;
    const years = (ref.getFullYear() - s.startYear) + (ref.getMonth() + 1 - s.startMonth) / 12;
    return Math.max(0, Math.round(years * 10) / 10);
  }

  /* normalize a salary to a comparable yearly figure in its own currency.
     Yearly figures in the app are in THOUSANDS; monthly are absolute. */
  function yearlyEquivalent(job) {
    if (job.salaryMin == null) return null;
    if (job.salaryPeriod === 'month') return Number(job.salaryMin) * 12;      // absolute
    return Number(job.salaryMin) * 1000;                                       // thousands → absolute
  }
  function expectedYearly(prefs, currency) {
    if (currency === 'SAR' && prefs.monthlyMinSAR) return Number(prefs.monthlyMinSAR) * 12;
    if (currency === 'AED' && prefs.monthlyMinAED) return Number(prefs.monthlyMinAED) * 12;
    if (prefs.minSalary) return Number(prefs.minSalary) * 1000;
    return null;
  }

  function band(score) {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Strong';
    if (score >= 55) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Weak';
  }
  function recommend(score, warnings) {
    if (warnings.some(w => w.blocking)) return 'Review manually';
    if (score >= 85) return 'Must apply';
    if (score >= 70) return 'Strong match — apply';
    if (score >= 55) return 'Good match — review';
    if (score >= 40) return 'Fair — review carefully';
    return 'Low relevance';
  }

  /* ---------- the scorer ---------- */
  function score(job, context) {
    const ctx = context || {};
    const profile = ctx.profile || (typeof Profile !== 'undefined' ? Profile.getState() : {});
    const prefs = (profile && profile.preferences) || {};
    const filters = ctx.filters || {};
    const decisions = ctx.decisions || {};
    const master = ctx.masterSkills || (profile.skills || []);
    const pSkills = (profile.skills || []);

    const reasons = [], strengths = [], gaps = [], warnings = [];
    const add = (component, points, max, text) => {
      reasons.push({ component, points: Math.round(points * 10) / 10, max, text });
      return points;
    };
    let total = 0;

    /* 1 — SKILLS (25) */
    const jobSkills = job.skills || [];
    const matchedSkills = jobSkills.filter(s => skillHit(pSkills, s));
    const missingSkills = jobSkills.filter(s => !skillHit(pSkills, s));
    const skillRatio = jobSkills.length ? matchedSkills.length / jobSkills.length : 0.5;
    total += add('skills', WEIGHTS.skills * skillRatio, WEIGHTS.skills,
      jobSkills.length ? `${matchedSkills.length}/${jobSkills.length} required skills matched` : 'No skills listed on the posting');
    if (matchedSkills.length) strengths.push('Skills: ' + matchedSkills.join(', '));
    if (missingSkills.length) gaps.push('Missing skills: ' + missingSkills.join(', '));

    /* 2 — RESUME MATCH (10) — overlap with the master résumé content */
    const resumeMatched = jobSkills.filter(s => skillHit(master, s));
    const resumeRatio = jobSkills.length ? resumeMatched.length / jobSkills.length : 0.5;
    total += add('resume', WEIGHTS.resume * resumeRatio, WEIGHTS.resume,
      `${resumeMatched.length}/${jobSkills.length || 0} skills evidenced in your master résumé`);
    if (jobSkills.length && resumeRatio < 0.34) gaps.push('Few of these skills appear in your master résumé');

    /* 3 — TITLE (12) — current title + saved target roles */
    const targets = String(prefs.targetRoles || '').split(',').map(s => s.trim()).filter(Boolean);
    const currentTitle = (profile.employment && profile.employment.title) || '';
    const titleHay = lc(job.title);
    const titleHit = targets.find(t => t && titleHay.indexOf(lc(t)) !== -1)
      || (currentTitle && titleHay.indexOf(lc(currentTitle)) !== -1 ? currentTitle : null);
    const titleTokenOverlap = (() => {
      const jt = tokens(job.title);
      const pt = uniq(targets.concat([currentTitle]).flatMap(tokens));
      if (!jt.length || !pt.length) return 0;
      return jt.filter(t => pt.indexOf(t) !== -1).length / jt.length;
    })();
    const titlePoints = titleHit ? WEIGHTS.title : WEIGHTS.title * titleTokenOverlap;
    total += add('title', titlePoints, WEIGHTS.title,
      titleHit ? `Title matches your target role “${titleHit}”` : `Partial title overlap (${Math.round(titleTokenOverlap * 100)}%)`);
    if (titleHit) strengths.push('Target role: ' + titleHit);
    else if (titleTokenOverlap < 0.3) gaps.push('Title does not match your saved target roles');

    /* 4 — LOCATION (12) — preferred countries, Riyadh/Saudi first, GCC */
    const locHay = lc([job.location, job.city, job.country].filter(Boolean).join(' '));
    const prefCountries = (filters.countries && filters.countries.length ? filters.countries
      : String(prefs.locations || '').split(',').map(s => s.trim()).filter(Boolean));
    const inPreferred = prefCountries.some(c => c && locHay.indexOf(lc(c)) !== -1);
    const isRiyadh = locHay.indexOf('riyadh') !== -1;
    const isSaudi = locHay.indexOf('saudi') !== -1 || locHay.indexOf('ksa') !== -1 || isRiyadh;
    let locPoints = 0, locationAssessment;
    if (isRiyadh) { locPoints = WEIGHTS.location; locationAssessment = 'Riyadh — top preference'; }
    else if (isSaudi) { locPoints = WEIGHTS.location * 0.92; locationAssessment = 'Saudi Arabia — preferred'; }
    else if (job.gccRelevant) { locPoints = WEIGHTS.location * 0.8; locationAssessment = 'GCC — relevant'; }
    else if (job.remote) { locPoints = WEIGHTS.location * 0.7; locationAssessment = 'Remote — location-independent'; }
    else if (inPreferred) { locPoints = WEIGHTS.location * 0.6; locationAssessment = 'In a preferred location'; }
    else { locPoints = WEIGHTS.location * 0.2; locationAssessment = 'Outside your preferred locations'; }
    total += add('location', locPoints, WEIGHTS.location, locationAssessment);
    if (isRiyadh || isSaudi) strengths.push(locationAssessment);
    if (!isSaudi && !job.gccRelevant && !job.remote) gaps.push('Not GCC, not remote');

    /* 5 — REMOTE PREFERENCE (6) */
    const wantRemote = lc(prefs.workMode || '') === 'remote';
    let remotePoints;
    if (wantRemote) remotePoints = job.remote ? WEIGHTS.remote : (job.hybrid ? WEIGHTS.remote * 0.5 : WEIGHTS.remote * 0.15);
    else remotePoints = WEIGHTS.remote * 0.7;
    total += add('remote', remotePoints, WEIGHTS.remote,
      wantRemote ? (job.remote ? 'Remote — matches your preference' : (job.hybrid ? 'Hybrid — partial match' : 'On-site — against your remote preference'))
        : 'No strict remote preference saved');
    if (wantRemote && job.onsite && !job.gccRelevant) gaps.push('On-site but you prefer remote');

    /* 6 — SALARY (12) */
    const jobYearly = yearlyEquivalent(job);
    const wantYearly = expectedYearly(prefs, job.currency);
    let salPoints, salaryAssessment;
    if (jobYearly == null) { salPoints = WEIGHTS.salary * 0.5; salaryAssessment = 'Not disclosed — never filtered out on salary'; }
    else if (wantYearly == null) { salPoints = WEIGHTS.salary * 0.6; salaryAssessment = 'No salary expectation saved'; }
    else if (jobYearly >= wantYearly * 1.15) { salPoints = WEIGHTS.salary; salaryAssessment = 'Above your expectation'; }
    else if (jobYearly >= wantYearly) { salPoints = WEIGHTS.salary * 0.85; salaryAssessment = 'Meets your expectation'; }
    else if (jobYearly >= wantYearly * 0.85) { salPoints = WEIGHTS.salary * 0.45; salaryAssessment = 'Slightly below your expectation'; }
    else { salPoints = 0; salaryAssessment = 'Below your minimum'; warnings.push({ code: 'salary_below', text: salaryAssessment, blocking: false }); }
    total += add('salary', salPoints, WEIGHTS.salary, salaryAssessment);
    if (salPoints >= WEIGHTS.salary * 0.85) strengths.push('Salary: ' + salaryAssessment);

    /* 7 — EXPERIENCE (8) */
    const years = experienceYearsAt(profile, job.postedAt);
    let expPoints;
    if (years == null || job.experienceMin == null) { expPoints = WEIGHTS.experience * 0.6; }
    else if (years >= job.experienceMin) { expPoints = WEIGHTS.experience; }
    else if (years >= job.experienceMin - 2) { expPoints = WEIGHTS.experience * 0.5; gaps.push(`Asks for ${job.experienceMin}+ years; you have ~${years}`); }
    else { expPoints = 0; gaps.push(`Asks for ${job.experienceMin}+ years; you have ~${years}`); }
    total += add('experience', expPoints, WEIGHTS.experience,
      years == null ? 'No dated employment history saved' : `~${years} years vs ${job.experienceMin == null ? 'unspecified' : job.experienceMin + '+'} required`);

    /* 8 — CERTIFICATIONS (5) */
    const pCerts = (profile.certifications || []).filter(c => c && c.name).map(c => c.name);
    const jCerts = job.certifications || [];
    const certHit = jCerts.filter(c => pCerts.some(pc => lc(pc).indexOf(lc(c)) !== -1 || lc(c).indexOf(lc(pc)) !== -1));
    const certPoints = jCerts.length ? WEIGHTS.certifications * (certHit.length / jCerts.length) : WEIGHTS.certifications * 0.6;
    total += add('certifications', certPoints, WEIGHTS.certifications,
      jCerts.length ? `${certHit.length}/${jCerts.length} requested certifications held` : 'No certifications requested');
    if (jCerts.length && !certHit.length) gaps.push('Requested certification(s) not held: ' + jCerts.join(', '));

    /* 9 — SENIORITY (4) */
    const jt = lc(job.title);
    const jobSenior = SENIOR_WORDS.some(w => jt.indexOf(w) !== -1);
    const jobJunior = JUNIOR_WORDS.some(w => jt.indexOf(w) !== -1);
    const meSenior = years == null ? true : years >= 5;
    let senPoints = WEIGHTS.seniority * 0.6;
    if (jobSenior && meSenior) senPoints = WEIGHTS.seniority;
    else if (jobJunior && meSenior) { senPoints = WEIGHTS.seniority * 0.2; gaps.push('Junior-titled role for your experience level'); }
    total += add('seniority', senPoints, WEIGHTS.seniority, jobSenior ? 'Senior-level title' : (jobJunior ? 'Junior-level title' : 'Mid-level title'));

    /* 10 — EMPLOYMENT TYPE (2) */
    const wantType = prefs.jobType || 'Full-time';
    const typeOk = !job.employmentType || lc(job.employmentType) === lc(wantType);
    total += add('employmentType', typeOk ? WEIGHTS.employmentType : 0, WEIGHTS.employmentType,
      typeOk ? `Employment type matches (${wantType})` : `Employment type is ${job.employmentType}, you prefer ${wantType}`);
    if (!typeOk) gaps.push('Employment type mismatch');

    /* 11 — VISA (2) — only matters when the job is outside your authorization */
    const authIn = lc((profile.authorization && profile.authorization.authorizedIn) || '');
    const localised = authIn && locHay.indexOf(authIn) !== -1;
    let visaPoints = WEIGHTS.visa;
    if (!localised && !job.remote) {
      visaPoints = job.visaSupport ? WEIGHTS.visa : 0;
      if (!job.visaSupport) warnings.push({ code: 'no_visa', text: 'Posting does not state visa sponsorship and you would need it', blocking: false });
    }
    total += add('visa', visaPoints, WEIGHTS.visa, localised ? 'Within your work authorization' : (job.visaSupport ? 'Visa sponsorship indicated' : 'No sponsorship stated'));

    /* 12 — KEYWORDS (2) */
    const kws = (filters.keywords || []).filter(Boolean);
    const hay = lc([job.title, job.company, job.description, (job.skills || []).join(' ')].join(' '));
    const kwHit = kws.filter(k => hay.indexOf(lc(k)) !== -1);
    const kwPoints = kws.length ? WEIGHTS.keywords * (kwHit.length / kws.length) : WEIGHTS.keywords * 0.6;
    total += add('keywords', kwPoints, WEIGHTS.keywords, kws.length ? `${kwHit.length}/${kws.length} keywords present` : 'No keywords supplied');

    /* EXCLUDED KEYWORDS — hard penalty + warning (never a silent drop) */
    const excluded = (filters.excludedKeywords || []).filter(Boolean);
    const exHit = excluded.filter(k => hay.indexOf(lc(k)) !== -1);
    if (exHit.length) {
      total -= EXCLUDED_PENALTY;
      warnings.push({ code: 'excluded_keyword', text: 'Contains excluded keyword(s): ' + exHit.join(', '), blocking: true });
      reasons.push({ component: 'excludedKeywords', points: -EXCLUDED_PENALTY, max: 0, text: 'Excluded keyword(s): ' + exHit.join(', ') });
    }

    /* PRIOR DECISIONS — read-only influence, never overwritten */
    const prior = decisions[job.id];
    if (prior === 'approved') {
      total += HISTORY_BONUS;
      reasons.push({ component: 'history', points: HISTORY_BONUS, max: HISTORY_BONUS, text: 'You approved this job before' });
      strengths.push('Previously approved by you');
    } else if (prior === 'rejected') {
      total -= HISTORY_PENALTY;
      reasons.push({ component: 'history', points: -HISTORY_PENALTY, max: 0, text: 'You rejected this job before' });
      warnings.push({ code: 'previously_rejected', text: 'You rejected this job before', blocking: false });
    }
    /* similar-company history (bounded) */
    const rejectedCompanies = ctx.rejectedCompanies || [];
    if (prior !== 'rejected' && rejectedCompanies.some(c => lc(c) === lc(job.company))) {
      total -= 3;
      reasons.push({ component: 'history', points: -3, max: 0, text: 'You have rejected roles at this company before' });
    }

    const finalScore = Math.round(clamp(total, 0, 100));
    return {
      score: finalScore,
      scoreBand: band(finalScore),
      reasons,
      strengths: uniq(strengths),
      gaps: uniq(gaps),
      warnings,
      matchedSkills, missingSkills,
      salaryAssessment, locationAssessment,
      recommendation: recommend(finalScore, warnings),
      version: VERSION,
    };
  }

  /* rank a list — stable ordering: score desc, then id asc (deterministic) */
  function rank(jobs, context) {
    const ctx = context || {};
    const scored = (jobs || []).map(j => Object.assign({}, j, { ranking: score(j, ctx) }));
    scored.sort((a, b) => (b.ranking.score - a.ranking.score) || String(a.id).localeCompare(String(b.id)));
    return scored;
  }

  return { VERSION, WEIGHTS, score, rank, band };
})();
