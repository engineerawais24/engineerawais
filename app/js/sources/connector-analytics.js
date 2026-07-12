/* ============================================================
   ConnectorAnalytics — per-connector performance metrics
   (Sprint 15 PART 7).

   Aggregates, per connector:
     jobs searched · normalized · duplicates removed · accepted ·
     rejected · response time (avg/last/max) · errors · runs ·
     successes → success rate.

   Persisted through AppStorage (Sprint 14) with an in-memory
   fallback. Read-only telemetry — it never touches user data.
   ============================================================ */

const ConnectorAnalytics = (() => {

  const STORAGE_KEY = 'connector_analytics';
  let _state = null;

  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && typeof saved === 'object') ? saved : {};
    return _state;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, load()); }

  function entry(id) {
    const s = load();
    let e = s[id];
    if (!e) {
      e = s[id] = {
        runs: 0, successes: 0, errors: 0,
        searched: 0, normalized: 0, duplicatesRemoved: 0, accepted: 0, rejected: 0,
        timing: { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 },
        lastRun: null, lastSuccess: null, lastError: null,
      };
    }
    return e;
  }

  /* record one lifecycle run's outcome */
  function record(id, m) {
    const e = entry(id);
    m = m || {};
    e.runs++;
    e.lastRun = Date.now();
    if (m.searched) e.searched += m.searched;
    if (m.normalized) e.normalized += m.normalized;
    if (m.duplicatesRemoved) e.duplicatesRemoved += m.duplicatesRemoved;
    if (m.accepted) e.accepted += m.accepted;
    if (m.rejected) e.rejected += m.rejected;
    if (m.responseMs != null) {
      const t = e.timing; t.count++; t.lastMs = m.responseMs; t.totalMs += m.responseMs; if (m.responseMs > t.maxMs) t.maxMs = m.responseMs;
    }
    if (m.ok) { e.successes++; e.lastSuccess = Date.now(); }
    if (m.error) { e.errors++; e.lastError = String(m.error); }
    persist();
    return e;
  }

  /* attribute duplicates removed to a connector after cross-source dedup */
  function addDuplicates(id, n) { const e = entry(id); e.duplicatesRemoved += (n || 0); persist(); return e; }

  function get(id) { return load()[id] || null; }
  function all() { return Object.assign({}, load()); }

  function summary(id) {
    const e = load()[id];
    if (!e) return { id, runs: 0, searched: 0, normalized: 0, duplicatesRemoved: 0, accepted: 0, rejected: 0, errors: 0, avgResponseMs: 0, maxResponseMs: 0, successRate: null };
    const t = e.timing;
    return {
      id, runs: e.runs, successes: e.successes, errors: e.errors,
      searched: e.searched, normalized: e.normalized, duplicatesRemoved: e.duplicatesRemoved,
      accepted: e.accepted, rejected: e.rejected,
      avgResponseMs: t.count ? Math.round(t.totalMs / t.count) : 0,
      lastResponseMs: Math.round(t.lastMs), maxResponseMs: Math.round(t.maxMs),
      successRate: e.runs ? Math.round((e.successes / e.runs) * 100) : null,
      lastRun: e.lastRun, lastSuccess: e.lastSuccess, lastError: e.lastError,
    };
  }
  function summaryAll(ids) { return (ids || Object.keys(load())).map(summary); }
  function reset() { _state = {}; persist(); }

  return { STORAGE_KEY, record, addDuplicates, get, all, summary, summaryAll, reset };
})();
