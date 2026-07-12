/* ============================================================
   JobCache — cache layer for job results (Sprint 14 PART 5).

   Entry:
     { key, source, data, createdAt, expiresAt, count, hash }

   Features:
     • cache key + source tagging
     • created time + expiry (TTL)
     • get() with stale-while-revalidate: an expired entry is still
       returned (stale:true) so the UI never blanks while a refresh
       runs in the background
     • refresh(producer) / invalidate(key) / invalidateSource() / clear()
     • dedupe — job lists are de-duplicated by id before caching
     • background-sync PLACEHOLDER — scheduleRefresh() records intent;
       a real backend worker fills it in later

   Persisted through AppStorage. Cache hits/misses feed Telemetry.
   ============================================================ */

const JobCache = (() => {

  const STORAGE_KEY = 'jobcache';
  const DEFAULT_TTL = 15 * 60 * 1000;   // 15 minutes
  let _entries = null;
  const _pendingRefresh = {};           // key -> producer (background-sync placeholder)

  function load() {
    if (_entries) return _entries;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _entries = (saved && typeof saved === 'object') ? saved : {};
    return _entries;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, load()); }

  /* de-duplicate a job list by stable id (falls back to a shallow key) */
  function dedupe(list) {
    if (!Array.isArray(list)) return list;
    const seen = new Set(); const out = [];
    list.forEach(j => {
      const k = (j && (j.id || j.sourceJobId)) || JSON.stringify(j);
      if (seen.has(k)) return;
      seen.add(k); out.push(j);
    });
    return out;
  }
  function hashOf(data) {
    try { const s = JSON.stringify(data); let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return String(h); }
    catch (e) { return String(Date.now()); }
  }

  function set(key, data, opts) {
    const o = opts || {};
    const value = Array.isArray(data) ? dedupe(data) : data;
    const now = Date.now();
    const ttl = o.ttlMs != null ? o.ttlMs : DEFAULT_TTL;
    const entries = load();
    entries[key] = {
      key, source: o.source || null, data: value,
      createdAt: now, expiresAt: now + ttl,
      count: Array.isArray(value) ? value.length : null,
      hash: hashOf(value),
    };
    persist();
    return entries[key];
  }

  /* stale-while-revalidate get: returns stale data (if any) rather
     than nothing, flagging it so the caller can trigger a refresh. */
  function get(key) {
    const e = load()[key];
    if (!e) { if (typeof Telemetry !== 'undefined') Telemetry.cacheMiss(); return { hit: false, stale: false, data: null }; }
    const stale = Date.now() > e.expiresAt;
    if (typeof Telemetry !== 'undefined') Telemetry.cacheHit();
    return { hit: true, stale, data: e.data, entry: e };
  }
  function fresh(key) { const r = get(key); return r.hit && !r.stale; }
  function peek(key) { return load()[key] || null; }

  async function refresh(key, producer, opts) {
    if (typeof producer !== 'function') return get(key);
    const data = await producer();
    return set(key, data, Object.assign({ source: (peek(key) || {}).source }, opts || {}));
  }

  /* background-sync PLACEHOLDER — records the intent to refresh a
     stale key. A real backend worker would drain this later. */
  function scheduleRefresh(key, producer) { _pendingRefresh[key] = producer || true; return Object.keys(_pendingRefresh); }
  function pendingRefreshKeys() { return Object.keys(_pendingRefresh); }

  function invalidate(key) { const e = load(); if (e[key]) { delete e[key]; persist(); return true; } return false; }
  function invalidateSource(source) {
    const e = load(); let n = 0;
    Object.keys(e).forEach(k => { if (e[k].source === source) { delete e[k]; n++; } });
    if (n) persist();
    return n;
  }
  function clear() { _entries = {}; persist(); }
  function count() { return Object.keys(load()).length; }
  function keys() { return Object.keys(load()); }
  function stats() {
    const e = load(); const now = Date.now();
    const ks = Object.keys(e);
    return { entries: ks.length, stale: ks.filter(k => now > e[k].expiresAt).length, jobs: ks.reduce((n, k) => n + (e[k].count || 0), 0) };
  }

  return { STORAGE_KEY, DEFAULT_TTL, set, get, fresh, peek, refresh, dedupe, scheduleRefresh, pendingRefreshKeys, invalidate, invalidateSource, clear, count, keys, stats };
})();
