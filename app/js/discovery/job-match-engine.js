/* ============================================================
   JobMatchEngine — reusable match scoring for discovered jobs
   (Sprint 25).

   Compares a job against a snapshot of the user's profile on five
   signals and returns a match PERCENTAGE (0–100):

     skills          40 — the job's required skills vs your skills
     experience      20 — the job's level vs your years
     titles          20 — the job's title vs your preferred titles
     locations       10 — the job's location vs your preferred locations
     certifications  10 — certifications the posting asks for

   Pure and deterministic: score(job, snapshot) always returns the same
   result for the same inputs. No DOM, no storage, no network.

   This does NOT replace MatchEngine (Sprint 8/20), which scores the
   Today's Jobs board and is relied on by Sprints 20–24. It is a second,
   additive engine for the discovery pipeline, and it reuses MatchEngine's
   primitives (tokens / levelOf / yearsFromProfile) when they are present
   so the two never disagree about what a "senior" role is.
   ============================================================ */

const JobMatchEngine = (() => {

  const WEIGHTS = { skills: 40, experience: 20, titles: 20, locations: 10, certifications: 10 };
  const TOTAL = Object.keys(WEIGHTS).reduce((n, k) => n + WEIGHTS[k], 0);   // 100

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function tokens(s) {
    if (typeof MatchEngine !== 'undefined' && MatchEngine.tokens) return MatchEngine.tokens(s);
    return new Set(lc(s).split(/[^a-z0-9]+/).filter(w => w.length > 2));
  }

  /* loose term match: "Azure" ↔ "Azure Administrator", "SQL" ↔ "SQL Server" */
  function termMatches(a, b) {
    const x = lc(a), y = lc(b);
    if (!x || !y) return false;
    return x === y || x.indexOf(y) !== -1 || y.indexOf(x) !== -1;
  }
  function inList(list, term) { return (list || []).some(t => termMatches(t, term)); }

  /* ---------- the profile snapshot (read-only) ---------- */
  function snapshotFromProfile(profile) {
    const p = profile || {};
    const prefs = p.preferences || {};
    const years = (typeof MatchEngine !== 'undefined' && MatchEngine.yearsFromProfile)
      ? MatchEngine.yearsFromProfile(p)
      : null;
    const splitList = v => String(v || '').split(/[,;/]| or /i).map(s => s.trim()).filter(Boolean);
    return {
      skills: (p.skills || []).slice(),
      certifications: (p.certifications || []).map(c => (c && c.name) ? c.name : String(c)).filter(Boolean),
      years,
      /* the level the candidate is at, from their years of experience */
      level: (typeof MatchEngine !== 'undefined' && MatchEngine.levelFromYears)
        ? MatchEngine.levelFromYears(years) : 'mid',
      preferredTitles: splitList(prefs.targetRoles),
      preferredLocations: splitList(prefs.locations || prefs.preferredLocations)
        .concat([p.contact && p.contact.city, p.contact && p.contact.country].filter(Boolean)),
      remoteOnly: !!prefs.remoteOnly,
    };
  }

  /* the level a candidate with N years sits at, in DiscoveryJob's vocabulary */
  function candidateLevel(years) {
    if (years == null) return 'Mid';
    if (years >= 9) return 'Lead';
    if (years >= 5) return 'Senior';
    if (years >= 2) return 'Mid';
    return 'Entry';
  }

  /* ---------- the five signals ---------- */

  function scoreSkills(job, snap) {
    const required = job.skills || [];
    if (!required.length) return { points: Math.round(WEIGHTS.skills * 0.5), matched: [], missing: [], ratio: 0.5 };
    const matched = required.filter(s => inList(snap.skills, s));
    const missing = required.filter(s => !inList(snap.skills, s));
    const ratio = matched.length / required.length;
    return { points: Math.round(WEIGHTS.skills * ratio), matched, missing, ratio };
  }

  function scoreExperience(job, snap) {
    const mine = candidateLevel(snap.years);
    const wanted = job.experienceLevel || 'Mid';
    const gap = Math.abs(DiscoveryJob.levelRank(mine) - DiscoveryJob.levelRank(wanted));
    /* exact level = full marks; one step either way still lands the interview */
    const ratio = gap === 0 ? 1 : gap === 1 ? 0.6 : gap === 2 ? 0.25 : 0;
    return { points: Math.round(WEIGHTS.experience * ratio), candidateLevel: mine, jobLevel: wanted, gap };
  }

  function scoreTitles(job, snap) {
    if (!snap.preferredTitles.length) return { points: Math.round(WEIGHTS.titles * 0.5), best: null, ratio: 0.5 };
    const jt = tokens(job.title);
    let best = 0, bestTitle = null;
    snap.preferredTitles.forEach(t => {
      const pt = tokens(t);
      if (!pt.size) return;
      let hit = 0;
      pt.forEach(tok => { if (jt.has(tok)) hit++; });
      const ratio = hit / pt.size;
      if (ratio > best) { best = ratio; bestTitle = t; }
    });
    return { points: Math.round(WEIGHTS.titles * best), best: bestTitle, ratio: best };
  }

  function scoreLocations(job, snap) {
    /* a remote job satisfies any location preference */
    if (job.workplaceType === 'Remote') return { points: WEIGHTS.locations, reason: 'Remote', ratio: 1 };
    if (!snap.preferredLocations.length) return { points: Math.round(WEIGHTS.locations * 0.5), reason: null, ratio: 0.5 };
    const hit = snap.preferredLocations.find(l => termMatches(job.location, l)
      || lc(job.location).indexOf(lc(l)) !== -1);
    return hit
      ? { points: WEIGHTS.locations, reason: hit, ratio: 1 }
      : { points: 0, reason: null, ratio: 0 };
  }

  function scoreCertifications(job, snap) {
    const wanted = job.certifications || [];
    /* nothing asked for → neutral, not a penalty */
    if (!wanted.length) return { points: Math.round(WEIGHTS.certifications * 0.5), matched: [], missing: [], ratio: 0.5 };
    const matched = wanted.filter(c => inList(snap.certifications, c));
    const ratio = matched.length / wanted.length;
    return {
      points: Math.round(WEIGHTS.certifications * ratio),
      matched,
      missing: wanted.filter(c => !inList(snap.certifications, c)),
      ratio,
    };
  }

  /* ---------- the score ---------- */
  function score(job, snapshot) {
    const snap = snapshot || snapshotFromProfile(
      (typeof Profile !== 'undefined') ? Profile.getState() : {}
    );
    const skills = scoreSkills(job, snap);
    const experience = scoreExperience(job, snap);
    const titles = scoreTitles(job, snap);
    const locations = scoreLocations(job, snap);
    const certifications = scoreCertifications(job, snap);

    const percentage = clamp(
      skills.points + experience.points + titles.points + locations.points + certifications.points,
      0, 100
    );

    const reasons = [];
    if (skills.matched.length) reasons.push(`${skills.matched.length}/${(job.skills || []).length} required skills matched`);
    if (experience.gap === 0) reasons.push(`${experience.jobLevel}-level role and you're ${experience.candidateLevel}-level`);
    if (titles.best) reasons.push(`Close to your target role "${titles.best}"`);
    if (locations.ratio === 1) reasons.push(locations.reason === 'Remote' ? 'Remote' : `In ${locations.reason}`);
    if (certifications.matched.length) reasons.push(`${certifications.matched.length} certification(s) matched`);

    return {
      percentage,
      parts: {
        skills: skills.points, experience: experience.points, titles: titles.points,
        locations: locations.points, certifications: certifications.points,
      },
      matchedSkills: skills.matched,
      missingSkills: skills.missing,
      matchedCertifications: certifications.matched,
      missingCertifications: certifications.missing,
      candidateLevel: experience.candidateLevel,
      jobLevel: experience.jobLevel,
      reasons,
    };
  }

  /* score a list, best first (deterministic tie-break on id) */
  function scoreAll(jobs, snapshot) {
    const snap = snapshot || snapshotFromProfile(
      (typeof Profile !== 'undefined') ? Profile.getState() : {}
    );
    return (jobs || [])
      .map(j => Object.assign({}, j, { match: score(j, snap) }))
      .sort((a, b) => (b.match.percentage - a.match.percentage) || String(a.id).localeCompare(String(b.id)));
  }

  return { WEIGHTS, TOTAL, snapshotFromProfile, candidateLevel, score, scoreAll, termMatches };
})();
