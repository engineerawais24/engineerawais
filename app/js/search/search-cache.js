/* ============================================================
   SearchCache — cached search results (Sprint 18 PART 7).

   Caches NORMALIZED + RANKED results, keyed by the filters, the
   selected providers, the ranking-engine version and the relevant
   profile preferences (so a preference change invalidates the key
   naturally, without deleting anything).

   • configurable TTL
   • valid entry → returned INSTANTLY (cache hit)
   • expired entry → still returned (STALE hit) so the UI never
     blanks, and the caller refreshes in the background
     (stale-while-refresh)
   • offline reads always allowed (even when stale)
   • bounded: MAX_ENTRIES with deterministic LRU eviction, so the
     cache can never grow forever
   • stats: hits, misses, staleHits, writes, evictions, lastRefresh

   Persisted through AppStorage (Sprint 14–17), so it works in BOTH
   local and backend mode. It NEVER overwrites newer unsynced local
   data: it only ever writes its own `searchcache` key, and a write
   is skipped when a newer entry for the same key already exists.

   Clearing the cache never touches jobs, decisions, applications,
   interviews, résumés, profile or preferences.
   ============================================================ */

const SearchCache = (() => {

  const STORAGE_KEY = 'searchcache';
  const DEFAULT_TTL = 10 * 60 * 1000;      // 10 minutes
  const MAX_ENTRIES = 25;

  let _state = null;

  function blank() {
    return { entries: {}, stats: { hits: 0, misses: 0, staleHits: 0, writes: 0, evictions: 0, lastRefresh: null } };
  }
  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && saved.entries && saved.stats) ? saved : blank();
    return _state;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, load()); }

  /* stable stringify so the same filters always produce the same key */
  function stable(v) {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (typeof v === 'object') {
      return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* cache key = filters + providers + ranking version + relevant prefs */
  function keyFor(filters, providers, prefs) {
    const p = prefs || {};
    const relevant = {
      targetRoles: p.targetRoles || '', locations: p.locations || '',
      minSalary: p.minSalary || 0, monthlyMinSAR: p.monthlyMinSAR || 0, monthlyMinAED: p.monthlyMinAED || 0,
      workMode: p.workMode || '', jobType: p.jobType || '', outsideGccMode: p.outsideGccMode || '',
    };
    const rv = (typeof SearchRanking !== 'undefined') ? SearchRanking.VERSION : 'sr-0';
    return 'sc-' + hash(stable({ f: filters || {}, p: (providers || []).slice().sort(), r: rv, pref: relevant }));
  }

  /* read — returns { hit, stale, jobs, entry } and records stats */
  function get(key, opts) {
    const o = opts || {};
    const s = load();
    const e = s.entries[key];
    if (!e) { s.stats.misses++; persist(); return { hit: false, stale: false, jobs: null, entry: null }; }
    const ttl = o.ttlMs != null ? o.ttlMs : (e.ttlMs != null ? e.ttlMs : DEFAULT_TTL);
    const stale = Date.now() > (e.createdAt + ttl);
    e.lastAccessedAt = Date.now();
    if (stale) s.stats.staleHits++; else s.stats.hits++;
    persist();
    return { hit: true, stale, jobs: e.jobs, entry: e };
  }

  function peek(key) { return load().entries[key] || null; }
  function isFresh(key, ttlMs) {
    const e = peek(key);
    if (!e) return false;
    const ttl = ttlMs != null ? ttlMs : (e.ttlMs != null ? e.ttlMs : DEFAULT_TTL);
    return Date.now() <= (e.createdAt + ttl);
  }

  /* bounded write with deterministic LRU eviction */
  function set(key, jobs, meta) {
    const s = load();
    const m = meta || {};
    const existing = s.entries[key];
    /* never overwrite a NEWER entry for the same key */
    if (existing && m.createdAt && existing.createdAt > m.createdAt) return existing;

    s.entries[key] = {
      key, jobs: jobs || [],
      count: (jobs || []).length,
      createdAt: m.createdAt || Date.now(),
      lastAccessedAt: Date.now(),
      ttlMs: m.ttlMs != null ? m.ttlMs : DEFAULT_TTL,
      filters: m.filters || null,
      providers: m.providers || [],
      searchId: m.searchId || null,
    };
    s.stats.writes++;
    s.stats.lastRefresh = Date.now();

    const keys = Object.keys(s.entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (s.entries[a].lastAccessedAt || 0) - (s.entries[b].lastAccessedAt || 0)
        || String(a).localeCompare(String(b)));                       // deterministic tie-break
      const drop = keys.slice(0, keys.length - MAX_ENTRIES);
      drop.forEach(k => { delete s.entries[k]; s.stats.evictions++; });
    }
    persist();
    return s.entries[key];
  }

  function invalidate(key) { const s = load(); if (s.entries[key]) { delete s.entries[key]; persist(); return true; } return false; }

  /* SAFE: only removes EXPIRED search-result entries. Never touches
     jobs, decisions, applications, interviews, résumés or profile. */
  function clearExpired(ttlMs) {
    const s = load();
    let removed = 0;
    Object.keys(s.entries).forEach(k => {
      const e = s.entries[k];
      const ttl = ttlMs != null ? ttlMs : (e.ttlMs != null ? e.ttlMs : DEFAULT_TTL);
      if (Date.now() > (e.createdAt + ttl)) { delete s.entries[k]; removed++; }
    });
    if (removed) persist();
    return removed;
  }
  function clearAll() { const st = load().stats; _state = { entries: {}, stats: st }; persist(); }

  function stats() {
    const s = load();
    const total = s.stats.hits + s.stats.staleHits + s.stats.misses;
    return Object.assign({}, s.stats, {
      entries: Object.keys(s.entries).length,
      maxEntries: MAX_ENTRIES,
      hitRate: total ? Math.round(((s.stats.hits + s.stats.staleHits) / total) * 100) : 0,
    });
  }
  function keys() { return Object.keys(load().entries); }
  function resetStats() { const s = load(); s.stats = blank().stats; persist(); }

  return {
    STORAGE_KEY, DEFAULT_TTL, MAX_ENTRIES,
    keyFor, get, set, peek, isFresh, invalidate, clearExpired, clearAll, stats, keys, resetStats,
  };
})();
