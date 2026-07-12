/* ============================================================
   Deduplicator — production cross-connector deduplication
   (Sprint 15 PART 6).

   A pure, read-only utility. Detects the same job appearing on
   multiple boards using several signals:
     • canonical URL match            → 'exact-url'
     • company + title + location similarity ≥ threshold → 'fuzzy'
   The surviving copy is chosen by SOURCE PRIORITY (a first-party
   posting beats an aggregator), its `sources[]` provenance is
   merged, and every merge records WHY it happened + the score.

   dedupe(jobs) → {
     unique:  job[],
     merged:  [{ kept:{id,source}, dropped:{id,source}, reason, score }],
     stats:   { input, unique, duplicates, byReason }
   }
   ============================================================ */

const Deduplicator = (() => {

  /* lower number = higher priority = kept on merge */
  const SOURCE_PRIORITY = {
    'LinkedIn': 1,
    'Greenhouse': 2, 'Lever': 2,
    'Workday': 3, 'SmartRecruiters': 3,
    'Bayt': 4, 'GulfTalent': 4,
    'Company Careers': 5,
  };
  const THRESHOLD = 0.82;

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const canon = j => String(j.canonicalUrl || j.applyUrl || '').split(/[?#]/)[0].toLowerCase().replace(/\/+$/, '');
  const priority = src => SOURCE_PRIORITY[src] != null ? SOURCE_PRIORITY[src] : 9;

  function tokens(s) { return new Set(norm(s).split(' ').filter(Boolean)); }
  function jaccard(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.size && !B.size) return 1;
    let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  /* 0..1 similarity from company (0.4) + title (0.4) + location (0.2) */
  function similarity(a, b) {
    const ca = norm(a.company), cb = norm(b.company);
    const companyScore = ca && cb && (ca === cb || ca.includes(cb) || cb.includes(ca)) ? 1 : jaccard(ca, cb);
    const titleScore = jaccard(a.title, b.title);
    const la = norm(a.location).split(' ')[0], lb = norm(b.location).split(' ')[0];
    const locScore = la && lb ? (la === lb ? 1 : 0) : 0.5;
    return companyScore * 0.4 + titleScore * 0.4 + locScore * 0.2;
  }

  function matchReason(a, b) {
    const ua = canon(a), ub = canon(b);
    if (ua && ub && ua === ub) return { reason: 'exact-url', score: 1 };
    const score = similarity(a, b);
    if (score >= THRESHOLD) return { reason: 'fuzzy(company+title+location)', score: Math.round(score * 100) / 100 };
    return null;
  }

  function mergeSources(keeper, dropped) {
    const seen = new Set((keeper.sources || []).map(s => s.source));
    const add = (dropped.sources && dropped.sources.length) ? dropped.sources
      : [{ source: dropped.source, applyUrl: dropped.applyUrl, sourceJobId: dropped.sourceJobId, company: dropped.company, postedDate: dropped.postedDate }];
    keeper.sources = (keeper.sources || []).slice();
    add.forEach(s => { if (s && !seen.has(s.source)) { keeper.sources.push(s); seen.add(s.source); } });
  }

  function dedupe(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    const groups = [];          // { keeper }
    const merged = [];
    const byReason = {};

    list.forEach(job => {
      let hit = null, match = null;
      for (const g of groups) {
        const m = matchReason(g.keeper, job);
        if (m) { hit = g; match = m; break; }
      }
      if (!hit) {
        groups.push({ keeper: Object.assign({}, job, { sources: (job.sources && job.sources.length) ? job.sources.slice() : [{ source: job.source, applyUrl: job.applyUrl, sourceJobId: job.sourceJobId, company: job.company, postedDate: job.postedDate }] }) });
        return;
      }
      /* decide the survivor by source priority */
      const keepIncoming = priority(job.source) < priority(hit.keeper.source);
      const winner = keepIncoming ? job : hit.keeper;
      const loser = keepIncoming ? hit.keeper : job;
      if (keepIncoming) {
        const preservedSources = hit.keeper.sources;
        hit.keeper = Object.assign({}, job, { sources: (job.sources && job.sources.length) ? job.sources.slice() : [{ source: job.source, applyUrl: job.applyUrl, sourceJobId: job.sourceJobId, company: job.company, postedDate: job.postedDate }] });
        (preservedSources || []).forEach(s => mergeSources(hit.keeper, { source: s.source, applyUrl: s.applyUrl, sourceJobId: s.sourceJobId, company: s.company, postedDate: s.postedDate, sources: [s] }));
      }
      mergeSources(hit.keeper, loser);
      byReason[match.reason] = (byReason[match.reason] || 0) + 1;
      merged.push({
        kept: { id: winner.id, source: winner.source },
        dropped: { id: loser.id, source: loser.source },
        reason: match.reason, score: match.score,
      });
    });

    const unique = groups.map(g => g.keeper);
    return {
      unique, merged,
      stats: { input: list.length, unique: unique.length, duplicates: list.length - unique.length, byReason },
    };
  }

  return { SOURCE_PRIORITY, THRESHOLD, similarity, dedupe };
})();
