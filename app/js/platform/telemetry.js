/* ============================================================
   Telemetry — performance measurement foundation (Sprint 14
   PART 8). Lightweight, local-only (no external analytics).

   Tracks aggregates (not every event, to stay cheap):
     timings  — page_render, search, connector, sync (+ any label):
                { count, totalMs, maxMs, lastMs }
     counters — cache hit / miss, operation retry count, …

   API:
     start(label) → token ; end(token) → ms       (span timing)
     measure(label, fn) → fn()'s return            (sync wrap)
     recordTiming(label, ms)
     incr(counter, by=1) ; cacheHit() ; cacheMiss() ; retry(label)
     snapshot() → { timings, counters }  (for the admin screen)

   Persisted through AppStorage; degrades to memory if unavailable.
   ============================================================ */

const Telemetry = (() => {

  const STORAGE_KEY = 'telemetry';
  let _state = null;

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && saved.timings && saved.counters) ? saved : { timings: {}, counters: {}, updatedAt: null };
    return _state;
  }
  function persist() {
    const s = load(); s.updatedAt = Date.now();
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, s);
  }

  function recordTiming(label, ms) {
    const s = load();
    const t = s.timings[label] || (s.timings[label] = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 });
    t.count++; t.lastMs = ms; t.totalMs += ms; if (ms > t.maxMs) t.maxMs = ms;
    persist();
    return t;
  }
  function start(label) { return { label, t0: now() }; }
  function end(token) {
    if (!token) return 0;
    const ms = Math.max(0, now() - token.t0);
    recordTiming(token.label, ms);
    return ms;
  }
  function measure(label, fn) {
    const tk = start(label);
    try { return fn(); } finally { end(tk); }
  }

  function incr(counter, by) {
    const s = load();
    s.counters[counter] = (s.counters[counter] || 0) + (by == null ? 1 : by);
    persist();
    return s.counters[counter];
  }
  function cacheHit() { return incr('cache_hit'); }
  function cacheMiss() { return incr('cache_miss'); }
  function retry(label) { incr('retry_total'); if (label) incr('retry_' + label); }

  function snapshot() {
    const s = load();
    const timings = {};
    Object.keys(s.timings).forEach(k => {
      const t = s.timings[k];
      timings[k] = { count: t.count, lastMs: Math.round(t.lastMs), avgMs: t.count ? Math.round(t.totalMs / t.count) : 0, maxMs: Math.round(t.maxMs) };
    });
    return { timings, counters: Object.assign({}, s.counters), updatedAt: s.updatedAt };
  }
  function reset() { _state = { timings: {}, counters: {}, updatedAt: Date.now() }; persist(); }

  return { STORAGE_KEY, start, end, measure, recordTiming, incr, cacheHit, cacheMiss, retry, snapshot, reset };
})();
