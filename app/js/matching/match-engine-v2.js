/* ============================================================
   MatchEngineV2 — the weighted job scoring engine (Sprint 29).

     Skills           35   synonym- and theme-aware, with confidence
     Experience       20   the posting's seniority vs your years
     Certifications   15   ladder-aware: a higher cert proves a lower one
     Location         10   your preferred locations, home city, remote
     Salary           10   the posting's pay vs your minimum
     Work mode         5   remote / hybrid / on-site compatibility
     Seniority/title   5   synonym-aware title similarity
     ─────────────────────
                     100

   It scores; it does NOT filter. The GCC/salary/region rules and the
   "undisclosed salary is never filtered" guarantee stay in MatchEngine
   (v1), whose contract is untouched — v1 remains the source of truth for
   `filtered`, `region` and work authorization.

   Deterministic and pure: the same job and snapshot always produce the
   same score. No DOM, no storage, no network.
   ============================================================ */

const MatchEngineV2 = (() => {

  const WEIGHTS = {
    skills: 35,
    experience: 20,
    certifications: 15,
    location: 10,
    salary: 10,
    workMode: 5,
    title: 5,
  };
  const TOTAL = Object.keys(WEIGHTS).reduce((n, k) => n + WEIGHTS[k], 0);   // 100

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();
  const pts = (weight, ratio) => Math.round(weight * Math.max(0, Math.min(1, ratio)));

  /* the same read-only snapshot the board already builds — no new contract */
  function snapshotFromProfile(profile, master) {
    return MatchEngine.snapshotFromProfile(profile, master);
  }

  /* ---------- 1 · skills (35) ---------- */
  function scoreSkills(job, snap) {
    const required = job.skills || [];
    const mine = (snap.skills || []).concat(snap.certs || []);
    const ev = SkillMatcher.evaluate(required, mine);

    /* a posting that lists no skills cannot be failed on them */
    const ratio = ev.ratio == null ? 0.5 : ev.ratio;
    const points = pts(WEIGHTS.skills, ratio);

    const reasons = [];
    if (ev.exact.length) reasons.push(`Strong ${ev.exact.slice(0, 2).join(' and ')} experience`);
    if (ev.related.length) reasons.push(`${ev.related.slice(0, 2).join(', ')} covered through related experience`);
    if (ev.transferable.length && !ev.exact.length) {
      reasons.push(`Transferable ${ev.transferable.slice(0, 2).join(', ')} background`);
    }

    return {
      points, max: WEIGHTS.skills, ratio,
      confidence: { exact: ev.exact, related: ev.related, transferable: ev.transferable },
      matched: ev.matched,
      missing: ev.missing,
      missingGroups: SkillMatcher.groupMissing(ev.missing),
      results: ev.results,
      reasons,
      note: required.length
        ? `${ev.exact.length} exact · ${ev.related.length} related · ${ev.transferable.length} transferable of ${required.length}`
        : 'The posting lists no required skills',
    };
  }

  /* ---------- 2 · experience (20) ---------- */
  function scoreExperience(job, snap) {
    const jobLevel = MatchEngine.levelOf(job.title);
    const mine = snap.level || 'mid';
    const gap = Math.abs(MatchEngine.levelRank(jobLevel) - MatchEngine.levelRank(mine));
    const ratio = gap === 0 ? 1 : gap === 1 ? 0.6 : gap === 2 ? 0.25 : 0;
    const reasons = [];
    if (gap === 0) reasons.push(`${jobLevel}-level role matches your experience`);
    else if (gap >= 2) reasons.push(`The role is ${jobLevel}-level and you are ${mine}-level`);
    return {
      points: pts(WEIGHTS.experience, ratio), max: WEIGHTS.experience, ratio,
      jobLevel, candidateLevel: mine, gap, years: snap.years, reasons,
      note: `${jobLevel}-level posting · you are ${mine}-level${snap.years != null ? ` (${snap.years} yrs)` : ''}`,
      gapFlag: gap >= 2,
    };
  }

  /* ---------- 3 · certifications (15) ---------- */
  function scoreCertifications(job, snap) {
    const required = CertHierarchy.requiredBy(job);
    const held = (snap.certs || []).map(name => ({ name }));

    /* nothing asked for → nothing can be unmet */
    if (!required.length) {
      return {
        points: WEIGHTS.certifications, max: WEIGHTS.certifications, ratio: 1,
        required: [], satisfied: [], missing: [], reasons: [],
        note: 'The posting names no certification',
      };
    }

    const satisfied = [];
    const missing = [];
    const reasons = [];
    required.forEach(req => {
      const r = CertHierarchy.satisfies(req.key, held);
      if (r.ok) {
        satisfied.push({ required: req.name, by: (r.by && r.by.name) || r.by, level: r.level });
        reasons.push(r.level === 'higher'
          ? `${(r.by && r.by.name) || r.by} exceeds the required ${req.name}`
          : `${req.name} matches the preferred qualification`);
      } else {
        missing.push(req.name);
      }
    });

    const ratio = satisfied.length / required.length;
    return {
      points: pts(WEIGHTS.certifications, ratio), max: WEIGHTS.certifications, ratio,
      required: required.map(r => r.name), satisfied, missing, reasons,
      note: `${satisfied.length}/${required.length} required certifications held`,
      gapFlag: missing.length > 0,
    };
  }

  /* ---------- 4 · location (10) ---------- */
  function scoreLocation(job, snap) {
    const loc = lc(job.location);
    const remote = job.workMode === 'Remote';
    const reasons = [];

    if (remote) {
      return { points: WEIGHTS.location, max: WEIGHTS.location, ratio: 1, matchedOn: 'Remote',
        reasons: ['Remote — location is not a constraint'], note: 'Remote role' };
    }
    const preferred = (snap.locations || []).find(p => p && loc.indexOf(lc(p)) !== -1);
    if (preferred) {
      reasons.push(`In ${preferred}, one of your preferred locations`);
      return { points: WEIGHTS.location, max: WEIGHTS.location, ratio: 1, matchedOn: preferred, reasons,
        note: `Matches your preferred location (${preferred})` };
    }
    if (snap.homeCity && loc.indexOf(lc(snap.homeCity)) !== -1) {
      reasons.push(`In ${snap.homeCity}, where you are based`);
      return { points: WEIGHTS.location, max: WEIGHTS.location, ratio: 1, matchedOn: snap.homeCity, reasons,
        note: 'In your home city' };
    }
    const authorized = (snap.authorizedIn || []).find(c => c && loc.indexOf(lc(c)) !== -1);
    if (authorized) {
      reasons.push(`In ${authorized}, where you are already authorized to work`);
      return { points: pts(WEIGHTS.location, 0.7), max: WEIGHTS.location, ratio: 0.7, matchedOn: authorized, reasons,
        note: 'Where you are authorized to work' };
    }
    return { points: 0, max: WEIGHTS.location, ratio: 0, matchedOn: null, reasons: [],
      note: `${job.location} is outside your preferred locations`, gapFlag: true };
  }

  /* ---------- 5 · salary (10) ---------- */
  function scoreSalary(job, snap) {
    const k = MatchEngine.usdK(job);
    const min = snap.minSalaryK || 0;

    /* the board's long-standing rule: an undisclosed salary is never held
       against a job — it scores half, and is never filtered */
    if (k == null) {
      return { points: Math.round(WEIGHTS.salary / 2), max: WEIGHTS.salary, ratio: 0.5,
        disclosed: false, reasons: [], note: 'Salary not disclosed — never counted against the role' };
    }
    if (!min) {
      return { points: WEIGHTS.salary, max: WEIGHTS.salary, ratio: 1, disclosed: true, reasons: [],
        note: 'No minimum salary set in your profile' };
    }

    const ratio = k >= min ? 1 : k >= min * 0.9 ? 0.6 : k >= min * 0.8 ? 0.3 : 0;
    const reasons = [];
    if (ratio === 1) reasons.push('Salary within target');
    else if (ratio === 0) reasons.push(`Below your $${min}k minimum`);

    return {
      points: pts(WEIGHTS.salary, ratio), max: WEIGHTS.salary, ratio,
      disclosed: true, usdK: Math.round(k), minK: min, reasons,
      note: `$${Math.round(k)}k vs your $${min}k minimum`,
      gapFlag: ratio < 0.6,
    };
  }

  /* ---------- 6 · work mode (5) ---------- */
  function scoreWorkMode(job, snap) {
    const want = lc(snap.workMode);
    const got = lc(job.workMode);
    const reasons = [];

    let ratio;
    if (!want || want === got) ratio = 1;
    else if (got === 'remote') ratio = 1;                       // remote suits every preference
    else if (want === 'remote' && got === 'hybrid') ratio = 0.4;
    else if (want === 'remote' && got === 'on-site') ratio = 0;
    else if (want === 'hybrid' && got === 'on-site') ratio = 0.4;
    else if (want === 'on-site' && got === 'hybrid') ratio = 0.7;
    else ratio = 0.5;

    if (ratio === 1) reasons.push(`${job.workMode} compatible`);
    else if (ratio === 0) reasons.push(`${job.workMode} conflicts with your ${snap.workMode} preference`);

    return {
      points: pts(WEIGHTS.workMode, ratio), max: WEIGHTS.workMode, ratio,
      want: snap.workMode, got: job.workMode, reasons,
      note: `${job.workMode} vs your ${snap.workMode || 'unset'} preference`,
      gapFlag: ratio === 0,
    };
  }

  /* ---------- 7 · seniority / title (5) ---------- */
  function scoreTitle(job, snap) {
    const targets = String(snap.targetRoles || '').split(',').map(s => s.trim()).filter(Boolean);
    const reasons = [];
    if (!targets.length) {
      return { points: Math.round(WEIGHTS.title / 2), max: WEIGHTS.title, ratio: 0.5, reasons,
        note: 'No target roles saved in your profile' };
    }

    /* a synonym of one of your target roles IS one of your target roles:
       "Presales" ≡ "Solutions Engineer" ≡ "Solutions Architect" */
    const synonym = targets.find(t => SynonymDictionary.sameGroup(t, job.title));
    if (synonym) {
      reasons.push(`${job.title} is one of your target roles`);
      return { points: WEIGHTS.title, max: WEIGHTS.title, ratio: 1, matchedOn: synonym, reasons,
        note: `${SynonymDictionary.canonical(job.title)} matches your target roles` };
    }

    /* otherwise fall back to token overlap against the titles you want */
    const jt = MatchEngine.tokens(job.title);
    let best = 0, bestTitle = null;
    targets.forEach(t => {
      const tt = MatchEngine.tokens(t);
      if (!tt.size) return;
      let hit = 0;
      tt.forEach(tok => { if (jt.has(tok)) hit++; });
      const r = hit / tt.size;
      if (r > best) { best = r; bestTitle = t; }
    });
    if (best >= 0.6) reasons.push(`Close to your target role "${bestTitle}"`);

    return {
      points: pts(WEIGHTS.title, best), max: WEIGHTS.title, ratio: best, matchedOn: bestTitle, reasons,
      note: bestTitle ? `Closest target role: ${bestTitle}` : 'No overlap with your target roles',
    };
  }

  /* ---------- the score ---------- */

  function evaluate(job, snap) {
    const skills = scoreSkills(job, snap);
    const experience = scoreExperience(job, snap);
    const certifications = scoreCertifications(job, snap);
    const location = scoreLocation(job, snap);
    const salary = scoreSalary(job, snap);
    const workMode = scoreWorkMode(job, snap);
    const title = scoreTitle(job, snap);

    const parts = {
      skills: skills.points,
      experience: experience.points,
      certifications: certifications.points,
      location: location.points,
      salary: salary.points,
      workMode: workMode.points,
      title: title.points,
    };
    const overall = Math.max(0, Math.min(100,
      Object.keys(parts).reduce((n, k) => n + parts[k], 0)));

    /* every reason the score can point at, best first */
    const reasons = []
      .concat(skills.reasons, certifications.reasons, salary.reasons,
        location.reasons, workMode.reasons, experience.reasons, title.reasons)
      .filter(Boolean);

    /* the factor list the board's "why ranked here?" panel renders. The
       labels 'Role fit' and 'Authorization & visa' are what DecisionEngine
       looks up, so 'Role fit' is kept here and the authorization factor is
       carried over from v1 by the caller. */
    const factors = [
      { label: 'Skills', points: skills.points, max: skills.max, note: skills.note, gap: skills.missing.length > 0 },
      { label: 'Experience relevance', points: experience.points, max: experience.max, note: experience.note, gap: !!experience.gapFlag },
      { label: 'Certifications', points: certifications.points, max: certifications.max, note: certifications.note, gap: !!certifications.gapFlag },
      { label: 'Location preference', points: location.points, max: location.max, note: location.note, gap: !!location.gapFlag },
      { label: 'Salary alignment', points: salary.points, max: salary.max, note: salary.note, gap: !!salary.gapFlag },
      { label: 'Work mode', points: workMode.points, max: workMode.max, note: workMode.note, gap: !!workMode.gapFlag },
      { label: 'Role fit', points: title.points, max: title.max, note: title.note, gap: false },
    ];

    /* the card's four chips, mapped so they still sum to the overall score —
       the UI is unchanged, only better informed */
    const breakdown = {
      overall,
      skills: { points: parts.skills + parts.certifications, max: WEIGHTS.skills + WEIGHTS.certifications },
      experience: { points: parts.experience + parts.title, max: WEIGHTS.experience + WEIGHTS.title },
      location: { points: parts.location + parts.workMode, max: WEIGHTS.location + WEIGHTS.workMode },
      salary: { points: parts.salary, max: WEIGHTS.salary },
    };

    /* requirement 6: every score explains itself */
    const explanation = {
      overall,
      skills: parts.skills,
      experience: parts.experience,
      certifications: parts.certifications,
      salary: parts.salary,
      location: parts.location,
      workMode: parts.workMode,
      title: parts.title,
      reasons: reasons.slice(0, 6),
    };

    return {
      overall,
      parts,
      factors,
      breakdown,
      explanation,
      reasons: reasons.slice(0, 4),          // the card's reason chips
      matched: skills.matched,
      missing: skills.missing,
      missingGroups: skills.missingGroups,
      confidence: skills.confidence,
      detail: { skills, experience, certifications, location, salary, workMode, title },
    };
  }

  return {
    WEIGHTS, TOTAL,
    snapshotFromProfile, evaluate,
    scoreSkills, scoreExperience, scoreCertifications,
    scoreLocation, scoreSalary, scoreWorkMode, scoreTitle,
  };
})();
