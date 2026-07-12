/* ============================================================
   SearchEngine — the job discovery engine (Sprint 18 PART 1, 4, 6).

   Orchestrates: providers → normalize → filter → deduplicate →
   rank → cache → history → diagnostics.

   • NEVER touches the UI (no DOM). A view calls it and renders.
   • NEVER submits an application. Discovery is strictly read-only.
   • Uses the existing storage abstraction (AppStorage), so history,
     cache and diagnostics work in BOTH local and backend mode.
   • Works OFFLINE from cached results.
   • A single provider failing NEVER fails the search.
   • Cancellable via AbortController.

   Results are handed to the EXISTING approval workflow unchanged:
   toDiscovered() maps UnifiedJobs onto the JobSchema records that
   JobsStore/Jobs/MatchEngine/DecisionEngine already consume, so
   Approve / Reject / Later behave exactly as before.
   ============================================================ */

const SearchEngine = (() => {

  const HISTORY_KEY = 'search_history';
  const DIAG_KEY = 'search_diagnostics';
  const MAX_HISTORY = 30;
  const SIMILARITY_THRESHOLD = 0.82;

  const _active = {};          // searchId → { controller, startedAt, … }
  let _seq = 0;

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();
  const uniq = a => Array.from(new Set(a));

  /* ---------- providers ---------- */
  function allProviders() {
    const list = [];
    if (typeof LinkedInProvider !== 'undefined') list.push(LinkedInProvider);
    if (typeof IndeedProvider !== 'undefined') list.push(IndeedProvider);
    if (typeof BaytProvider !== 'undefined') list.push(BaytProvider);
    if (typeof GulfTalentProvider !== 'undefined') list.push(GulfTalentProvider);
    if (typeof GreenhouseProvider !== 'undefined') list.push(GreenhouseProvider);
    if (typeof LeverProvider !== 'undefined') list.push(LeverProvider);
    return list;
  }
  function providerIds() { return allProviders().map(p => p.id); }
  function providerById(id) { return allProviders().find(p => p.id === id) || null; }
  function providerHealth() { return allProviders().map(p => p.health()); }
  function refreshProviderHealth() {
    allProviders().forEach(p => { try { p.connect({}); } catch (e) { /* ignore */ } });
    return providerHealth();
  }

  /* ---------- filters ---------- */
  function normalizeFilters(f) {
    const x = f || {};
    const arr = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
    return {
      query: String(x.query || '').trim(),
      titles: arr(x.titles).map(String),
      locations: arr(x.locations).map(String),
      countries: arr(x.countries).map(String),
      remote: !!x.remote, hybrid: !!x.hybrid, onsite: !!x.onsite,
      salaryMin: x.salaryMin != null && x.salaryMin !== '' ? Number(x.salaryMin) : null,
      salaryMax: x.salaryMax != null && x.salaryMax !== '' ? Number(x.salaryMax) : null,
      currency: x.currency || null,
      experienceMin: x.experienceMin != null && x.experienceMin !== '' ? Number(x.experienceMin) : null,
      experienceMax: x.experienceMax != null && x.experienceMax !== '' ? Number(x.experienceMax) : null,
      employmentType: x.employmentType || null,
      keywords: arr(x.keywords).map(String),
      excludedKeywords: arr(x.excludedKeywords).map(String),
      providers: arr(x.providers).map(String),
    };
  }

  function applyFilters(jobs, f) {
    let list = jobs.slice();
    if (f.query) {
      const q = lc(f.query);
      list = list.filter(j => lc([j.title, j.company, j.description, (j.skills || []).join(' ')].join(' ')).indexOf(q) !== -1);
    }
    if (f.titles.length) list = list.filter(j => f.titles.some(t => lc(j.title).indexOf(lc(t)) !== -1));
    if (f.locations.length) list = list.filter(j => f.locations.some(l => lc([j.location, j.city].join(' ')).indexOf(lc(l)) !== -1));
    if (f.countries.length) list = list.filter(j => f.countries.some(c => lc([j.location, j.country].join(' ')).indexOf(lc(c)) !== -1));

    /* work-mode filters are inclusive OR; none checked = no constraint */
    if (f.remote || f.hybrid || f.onsite) {
      list = list.filter(j => (f.remote && j.remote) || (f.hybrid && j.hybrid) || (f.onsite && j.onsite));
    }
    /* an undisclosed salary is NEVER filtered out (existing salary rule) */
    if (f.salaryMin != null) list = list.filter(j => j.salaryMin == null || Number(j.salaryMin) >= f.salaryMin);
    if (f.salaryMax != null) list = list.filter(j => j.salaryMin == null || Number(j.salaryMin) <= f.salaryMax);
    if (f.experienceMin != null) list = list.filter(j => j.experienceMax == null || Number(j.experienceMax) >= f.experienceMin);
    if (f.experienceMax != null) list = list.filter(j => j.experienceMin == null || Number(j.experienceMin) <= f.experienceMax);
    if (f.employmentType) list = list.filter(j => !j.employmentType || lc(j.employmentType) === lc(f.employmentType));
    if (f.keywords.length) {
      list = list.filter(j => {
        const hay = lc([j.title, j.company, j.description, (j.skills || []).join(' ')].join(' '));
        return f.keywords.some(k => hay.indexOf(lc(k)) !== -1);
      });
    }
    /* excluded keywords are NOT dropped here — ranking flags them with a
       blocking warning so nothing disappears silently. */
    return list;
  }

  /* ---------- PART 4: deterministic deduplication ---------- */
  function tokens(s) { return uniq(lc(s).split(/[^a-z0-9+#.]+/).filter(Boolean)); }
  function jaccard(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.length && !B.length) return 1;
    const setB = new Set(B);
    let inter = 0;
    A.forEach(t => { if (setB.has(t)) inter++; });
    const union = A.length + B.length - inter;
    return union ? inter / union : 0;
  }
  function similarity(a, b) {
    const ca = lc(a.company), cb = lc(b.company);
    const companyScore = (ca && cb && (ca === cb || ca.indexOf(cb) !== -1 || cb.indexOf(ca) !== -1)) ? 1 : jaccard(ca, cb);
    const titleScore = jaccard(a.title, b.title);
    const la = lc(a.city || a.location).split(/[\s,]+/)[0];
    const lb = lc(b.city || b.location).split(/[\s,]+/)[0];
    const locScore = (la && lb) ? (la === lb ? 1 : 0) : 0.5;
    const descScore = jaccard(a.description, b.description);
    return companyScore * 0.38 + titleScore * 0.34 + locScore * 0.18 + descScore * 0.10;
  }
  function completeness(j) {
    let n = 0;
    ['title', 'company', 'location', 'city', 'country', 'salaryMin', 'salaryMax', 'currency', 'salaryPeriod',
      'employmentType', 'experienceMin', 'experienceMax', 'description', 'url', 'postedAt', 'logo'].forEach(f => {
        const v = j[f];
        if (v !== null && v !== undefined && v !== '') n++;
      });
    n += (j.skills || []).length ? 1 : 0;
    n += (j.certifications || []).length ? 1 : 0;
    return n;
  }
  function newer(a, b) {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return ta >= tb ? a : b;
  }

  /* deep-ish clone so deduplicate NEVER mutates the caller's array
     (mutating a shared mergeMeta would make repeat runs non-deterministic) */
  function cloneJob(j) {
    const c = Object.assign({}, j);
    c.providers = (j.providers || []).slice();
    c.skills = (j.skills || []).slice();
    c.certifications = (j.certifications || []).slice();
    const mm = j.mergeMeta || {};
    c.mergeMeta = {
      sourceUrls: (mm.sourceUrls || (j.url ? [j.url] : [])).slice(),
      sourceIds: (mm.sourceIds || (j.sourceId ? [String(j.sourceId)] : [])).slice(),
      merged: (mm.merged || []).slice(),
    };
    return c;
  }

  function mergeInto(master, dup, reason, scoreVal) {
    /* provenance is NEVER lost */
    master.providers = uniq((master.providers || []).concat(dup.providers || [dup.provider]).filter(Boolean));
    const mm = master.mergeMeta;
    mm.sourceUrls = uniq(mm.sourceUrls.concat((dup.mergeMeta && dup.mergeMeta.sourceUrls) || [dup.url]).filter(Boolean));
    mm.sourceIds = uniq(mm.sourceIds.concat((dup.mergeMeta && dup.mergeMeta.sourceIds) || [dup.sourceId]).filter(Boolean));
    mm.merged = mm.merged.concat([{ provider: dup.provider, sourceId: dup.sourceId, url: dup.url, reason, similarity: Math.round(scoreVal * 100) / 100 }]);
    /* fill any gap the master is missing from the duplicate */
    ['salaryMin', 'salaryMax', 'currency', 'salaryPeriod', 'employmentType', 'experienceMin', 'experienceMax', 'logo', 'city', 'country'].forEach(f => {
      if ((master[f] === null || master[f] === undefined || master[f] === '') && dup[f] != null && dup[f] !== '') master[f] = dup[f];
    });
    if (!master.description && dup.description) master.description = dup.description;
    if (!(master.skills || []).length && (dup.skills || []).length) master.skills = dup.skills.slice();
    master.visaSupport = master.visaSupport || dup.visaSupport;
    /* prefer the newest valid postedAt / updatedAt — no Date.now(), so the
       output stays deterministic for the same input */
    const pick = newer(master, dup);
    if (pick.postedAt) master.postedAt = pick.postedAt;
    const ua = Date.parse(master.updatedAt || 0) || 0;
    const ub = Date.parse(dup.updatedAt || 0) || 0;
    master.updatedAt = ub > ua ? dup.updatedAt : master.updatedAt;
    return master;
  }

  function deduplicate(jobs, options) {
    const o = options || {};
    const threshold = o.threshold != null ? o.threshold : SIMILARITY_THRESHOLD;
    /* deterministic input order → deterministic output */
    const input = (jobs || []).slice().sort((a, b) =>
      String(a.provider).localeCompare(String(b.provider))
      || String(a.sourceId).localeCompare(String(b.sourceId))
      || String(a.id).localeCompare(String(b.id)));

    const groups = [];
    const merges = [];
    input.forEach(job => {
      const canon = BaseProvider.canonicalUrl(job.url);
      let target = null, reason = null, sc = 0;
      for (const g of groups) {
        if (canon && BaseProvider.canonicalUrl(g.master.url) === canon) { target = g; reason = 'exact-url'; sc = 1; break; }
        if (job.sourceId && g.master.sourceId === job.sourceId && lc(g.master.provider) === lc(job.provider)) { target = g; reason = 'same-source-id'; sc = 1; break; }
        const s = similarity(g.master, job);
        if (s >= threshold) { target = g; reason = 'similarity'; sc = s; break; }
      }
      if (!target) { groups.push({ master: cloneJob(job) }); return; }

      /* prefer the most complete record; tie → newest postedAt */
      const m = target.master;
      const keepIncoming = completeness(job) > completeness(m)
        || (completeness(job) === completeness(m) && Date.parse(job.postedAt || 0) > Date.parse(m.postedAt || 0));
      if (keepIncoming) {
        const old = m;
        target.master = cloneJob(job);
        mergeInto(target.master, old, reason, sc);
      } else {
        mergeInto(m, cloneJob(job), reason, sc);
      }
      merges.push({
        kept: { provider: target.master.provider, sourceId: target.master.sourceId },
        dropped: { provider: job.provider, sourceId: job.sourceId, url: job.url },
        reason, similarity: Math.round(sc * 100) / 100,
      });
    });

    const unique = groups.map(g => g.master);
    return { jobs: unique, duplicateCount: input.length - unique.length, merges, threshold };
  }

  /* ---------- normalize / rank ---------- */
  function normalize(rawJob, provider) {
    const p = typeof provider === 'string' ? providerById(provider) : provider;
    if (p && typeof p.normalize === 'function') return p.normalize(rawJob);
    return BaseProvider.unified(rawJob);
  }

  function rankingContext(filters) {
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : {};
    let masterSkills = profile.skills || [];
    try {
      if (typeof TailorEngine !== 'undefined') masterSkills = TailorEngine.masterContent(profile).skills || masterSkills;
    } catch (e) { /* fall back to profile skills */ }
    let decisions = {};
    try { if (typeof JobsStore !== 'undefined') decisions = JobsStore.load().decisions || {}; } catch (e) { /* none */ }
    return { profile, masterSkills, decisions, filters: filters || {} };
  }

  function rank(jobs, context) {
    if (typeof SearchRanking === 'undefined') return (jobs || []).slice();
    return SearchRanking.rank(jobs, context || rankingContext());
  }

  /* ---------- history + diagnostics (AppStorage) ---------- */
  function history() {
    const h = (typeof AppStorage !== 'undefined') ? AppStorage.get(HISTORY_KEY) : null;
    return Array.isArray(h) ? h : [];
  }
  function pushHistory(entry) {
    const h = history();
    h.unshift(entry);
    if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
    if (typeof AppStorage !== 'undefined') AppStorage.set(HISTORY_KEY, h);
    return entry;
  }
  function getHistory(n) { return n ? history().slice(0, n) : history(); }
  function clearHistory() { if (typeof AppStorage !== 'undefined') AppStorage.set(HISTORY_KEY, []); }

  function isOffline(options) {
    const o = options || {};
    if (o.offline != null) return !!o.offline;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    return false;
  }
  function prefs() {
    try { return (typeof Profile !== 'undefined') ? (Profile.getState().preferences || {}) : {}; }
    catch (e) { return {}; }
  }

  /* ---------- the search ---------- */
  function newSearchId() { _seq++; return 'srch-' + Date.now().toString(36) + '-' + _seq; }

  function historyEntry(base) {
    return Object.assign({
      id: null, filters: null, providersRequested: [], providersCompleted: [], providersFailed: [],
      startedAt: null, completedAt: null, durationMs: 0,
      rawResultCount: 0, duplicateCount: 0, finalResultCount: 0,
      cacheHit: false, offline: false, cancelled: false,
      averageScore: 0, topScore: 0, errorSummary: [],
    }, base || {});
  }

  function summarize(jobs) {
    const scores = jobs.map(j => (j.ranking && j.ranking.score) || 0);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const top = scores.length ? Math.max.apply(null, scores) : 0;
    return { averageScore: avg, topScore: top };
  }

  async function runProviders(ids, f, searchId, options, signal) {
    const chosen = ids.map(providerById).filter(Boolean);
    const settled = await Promise.all(chosen.map(p =>
      p.search(f, { signal, transport: options.transport ? options.transport(p.id) : (options.providerTransport || null) })
        .catch(e => ({ ok: false, provider: p.label, jobs: [], error: (e && e.message) || 'provider crashed' }))
    ));
    const completed = [], failed = [], errors = [];
    let raw = [];
    settled.forEach((r, i) => {
      const p = chosen[i];
      if (r && r.ok) { completed.push(p.label); raw = raw.concat(r.jobs || []); }
      else { failed.push(p.label); errors.push({ provider: p.label, error: (r && r.error) || 'unknown' }); }
    });
    return { raw, completed, failed, errors };
  }

  async function search(filters, options) {
    options = options || {};
    const f = normalizeFilters(filters);
    const ids = f.providers.length ? f.providers.filter(id => !!providerById(id)) : providerIds();
    const p = prefs();
    const key = (typeof SearchCache !== 'undefined') ? SearchCache.keyFor(f, ids, p) : null;
    const searchId = newSearchId();
    const startedAt = Date.now();
    const offline = isOffline(options);
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    _active[searchId] = { searchId, controller, startedAt, filters: f, providers: ids };

    const finish = (entry, jobs) => {
      delete _active[searchId];
      pushHistory(entry);
      return { searchId, jobs: jobs || [], history: entry, diagnostics: getDiagnostics() };
    };

    try {
      /* 1 — cache */
      const cached = (options.refresh || options.noCache || !key || typeof SearchCache === 'undefined')
        ? { hit: false } : SearchCache.get(key, { ttlMs: options.ttlMs });

      if (cached.hit && !cached.stale) {
        const jobs = cached.jobs || [];
        const s = summarize(jobs);
        return finish(historyEntry({
          id: searchId, filters: f, providersRequested: ids, providersCompleted: ids, providersFailed: [],
          startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
          rawResultCount: jobs.length, duplicateCount: (cached.entry && cached.entry.duplicateCount) || 0,
          finalResultCount: jobs.length, cacheHit: true, offline, averageScore: s.averageScore, topScore: s.topScore,
        }), jobs);
      }

      if (cached.hit && cached.stale) {
        /* stale-while-refresh: serve stale immediately; refresh in the
           background when online (never blocks the caller) */
        const jobs = cached.jobs || [];
        const s = summarize(jobs);
        if (!offline && !options.noBackgroundRefresh) {
          setTimeout(() => { search(filters, Object.assign({}, options, { refresh: true, background: true })).catch(() => {}); }, 0);
        }
        return finish(historyEntry({
          id: searchId, filters: f, providersRequested: ids, providersCompleted: ids, providersFailed: [],
          startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
          rawResultCount: jobs.length, duplicateCount: (cached.entry && cached.entry.duplicateCount) || 0,
          finalResultCount: jobs.length, cacheHit: true, offline,
          averageScore: s.averageScore, topScore: s.topScore,
          errorSummary: offline ? [{ provider: 'engine', error: 'offline — served stale cache' }] : [],
        }), jobs);
      }

      /* 2 — offline with no cache: nothing to serve, but never an error state */
      if (offline) {
        return finish(historyEntry({
          id: searchId, filters: f, providersRequested: ids, providersCompleted: [], providersFailed: [],
          startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
          offline: true, errorSummary: [{ provider: 'engine', error: 'offline and no cached results for these filters' }],
        }), []);
      }

      /* 3 — live provider fan-out (a failure never fails the search) */
      const signal = controller ? controller.signal : null;
      const { raw, completed, failed, errors } = await runProviders(ids, f, searchId, options, signal);

      if (signal && signal.aborted) {
        return finish(historyEntry({
          id: searchId, filters: f, providersRequested: ids, providersCompleted: completed, providersFailed: failed,
          startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
          rawResultCount: raw.length, cancelled: true, errorSummary: errors,
        }), []);
      }

      /* 4 — filter → dedupe → rank */
      const filtered = applyFilters(raw, f);
      const dedup = deduplicate(filtered, { threshold: options.threshold });
      const ranked = rank(dedup.jobs, rankingContext(f));
      const s = summarize(ranked);

      /* 5 — cache + history */
      if (key && typeof SearchCache !== 'undefined') {
        SearchCache.set(key, ranked, { filters: f, providers: ids, searchId, ttlMs: options.ttlMs, duplicateCount: dedup.duplicateCount });
      }

      const entry = historyEntry({
        id: searchId, filters: f, providersRequested: ids, providersCompleted: completed, providersFailed: failed,
        startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
        rawResultCount: raw.length, duplicateCount: dedup.duplicateCount, finalResultCount: ranked.length,
        cacheHit: false, offline: false, cancelled: false,
        averageScore: s.averageScore, topScore: s.topScore, errorSummary: errors,
      });
      const out = finish(entry, ranked);
      out.merges = dedup.merges;
      return out;

    } catch (e) {
      return finish(historyEntry({
        id: searchId, filters: f, providersRequested: ids, providersFailed: ids,
        startedAt, completedAt: Date.now(), durationMs: Date.now() - startedAt,
        errorSummary: [{ provider: 'engine', error: (e && e.message) || 'search failed' }],
      }), []);
    }
  }

  function refresh(filters, options) { return search(filters, Object.assign({}, options || {}, { refresh: true })); }

  function cancel(searchId) {
    const a = _active[searchId];
    if (!a) return { ok: false, error: 'no active search with that id' };
    if (a.controller) { try { a.controller.abort(); } catch (e) { /* ignore */ } }
    a.cancelled = true;
    return { ok: true, searchId };
  }
  function cancelAll() { return Object.keys(_active).map(cancel); }
  function activeSearches() { return Object.keys(_active).map(id => ({ id, startedAt: _active[id].startedAt, providers: _active[id].providers })); }

  function rerun(searchId, options) {
    const e = history().find(h => h.id === searchId);
    if (!e) return Promise.resolve({ searchId: null, jobs: [], error: 'search not found in history' });
    return search(e.filters, Object.assign({ refresh: true }, options || {}));
  }

  /* ---------- diagnostics (PART 9) ---------- */
  function getDiagnostics() {
    const h = history();
    const today = new Date().toISOString().slice(0, 10);
    const done = h.filter(x => !x.cancelled);
    const cacheStats = (typeof SearchCache !== 'undefined') ? SearchCache.stats() : {};
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const succeeded = h.filter(x => !x.cancelled && (x.providersFailed || []).length < (x.providersRequested || []).length);
    const failedRuns = h.filter(x => (x.providersFailed || []).length && (x.providersFailed || []).length === (x.providersRequested || []).length);
    return {
      totalSearches: h.length,
      searchesToday: h.filter(x => x.startedAt && new Date(x.startedAt).toISOString().slice(0, 10) === today).length,
      averageDurationMs: avg(done.map(x => x.durationMs || 0)),
      averageResultCount: avg(done.map(x => x.finalResultCount || 0)),
      cacheHitRate: cacheStats.hitRate != null ? cacheStats.hitRate : 0,
      cacheHits: cacheStats.hits || 0,
      staleCacheHits: cacheStats.staleHits || 0,
      cacheEntries: cacheStats.entries || 0,
      duplicateCount: h.reduce((n, x) => n + (x.duplicateCount || 0), 0),
      averageRankingScore: avg(done.filter(x => x.finalResultCount).map(x => x.averageScore || 0)),
      providerHealth: providerHealth(),
      providerFailureCount: h.reduce((n, x) => n + ((x.providersFailed || []).length), 0),
      lastSuccessfulSearch: succeeded.length ? succeeded[0].completedAt : null,
      lastFailedSearch: failedRuns.length ? failedRuns[0].completedAt : null,
      activeSearch: activeSearches()[0] || null,
      activeSearchCount: activeSearches().length,
      cancelledSearchCount: h.filter(x => x.cancelled).length,
      offlineSearchCount: h.filter(x => x.offline).length,
    };
  }
  function exportDiagnostics() {
    return JSON.stringify({ exportedAt: new Date().toISOString(), diagnostics: getDiagnostics(), history: history() }, null, 2);
  }

  /* ---------- hand-off to the EXISTING approval workflow ---------- */
  /* Maps UnifiedJobs onto the JobSchema records JobsStore/Jobs/
     MatchEngine/DecisionEngine already consume, so Approve / Reject /
     Later keep working exactly as before. No submission happens here. */
  function toDiscovered(jobs) {
    if (typeof JobSchema === 'undefined') return [];
    return (jobs || []).map(j => {
      const disclosed = j.salaryMin != null;
      const workMode = j.remote ? 'Remote' : (j.hybrid ? 'Hybrid' : 'On-site');
      return JobSchema.normalized({
        id: j.id,
        source: (j.providers && j.providers[0]) || j.provider || 'Unknown',
        sourceJobId: j.sourceId || j.id,
        title: j.title, company: j.company,
        location: j.location || [j.city, j.country].filter(Boolean).join(', '),
        workMode, employmentType: j.employmentType || 'Full-time',
        salary: disclosed ? j.salaryMin : null,
        salaryMax: disclosed ? j.salaryMax : null,
        salaryDisclosed: disclosed,
        currency: j.currency || 'USD',
        salaryPeriod: j.salaryPeriod === 'month' ? 'month' : 'year',
        visaSponsorship: !!j.visaSupport,
        description: j.description || '',
        skills: j.skills || [], preferredSkills: [],
        applyUrl: j.url, canonicalUrl: BaseProvider.canonicalUrl(j.url),
        postedDate: j.postedAt ? String(j.postedAt).slice(0, 10) : null,
        companyCareerPage: null, companyLogo: j.logo || null,
        sources: (j.mergeMeta ? j.mergeMeta.sourceUrls : []).map((u, i) => ({
          source: (j.providers || [])[i] || j.provider, applyUrl: u,
          sourceJobId: (j.mergeMeta.sourceIds || [])[i] || j.sourceId, company: j.company, postedDate: j.postedAt,
        })),
      });
    });
  }

  return {
    HISTORY_KEY, DIAG_KEY, SIMILARITY_THRESHOLD,
    search, refresh, cancel, cancelAll, normalize, deduplicate, rank,
    getHistory, clearHistory, rerun, getDiagnostics, exportDiagnostics,
    allProviders, providerIds, providerById, providerHealth, refreshProviderHealth,
    normalizeFilters, applyFilters, similarity, rankingContext, activeSearches, toDiscovered,
  };
})();
