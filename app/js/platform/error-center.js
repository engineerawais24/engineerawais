/* ============================================================
   ErrorCenter — centralized error store (Sprint 14 PART 6).

   One place every failure is recorded: connector, submission,
   sync, storage, validation and API errors. Each entry carries:
     { id, category, message, source, timestamp, severity,
       retryable, resolved, technical }

   Categories: connector | submission | sync | storage |
               validation | api
   Severity:   info | warning | error | critical

   In-memory + write-through to AppStorage so it survives reloads;
   if storage is unavailable it degrades to memory-only (the app
   keeps working — PART 9). Capped so it can never grow unbounded.
   ============================================================ */

const ErrorCenter = (() => {

  const STORAGE_KEY = 'errors';
  const MAX = 200;
  const CATEGORIES = ['connector', 'submission', 'sync', 'storage', 'validation', 'api'];
  const SEVERITIES = ['info', 'warning', 'error', 'critical'];

  let _log = null;   // in-memory cache

  function load() {
    if (_log) return _log;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _log = Array.isArray(saved) ? saved : [];
    return _log;
  }
  function persist() {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, _log);
  }

  function record(e) {
    const list = load();
    const entry = {
      id: 'err-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      category: CATEGORIES.includes(e.category) ? e.category : 'api',
      message: String(e.message || 'Unknown error'),
      source: e.source || null,
      timestamp: Date.now(),
      severity: SEVERITIES.includes(e.severity) ? e.severity : 'error',
      retryable: !!e.retryable,
      resolved: false,
      technical: e.technical != null ? e.technical : null,
    };
    list.unshift(entry);
    if (list.length > MAX) list.length = MAX;
    persist();
    return entry;
  }

  function list(filter) {
    const all = load().slice();
    if (!filter) return all;
    return all.filter(x =>
      (!filter.category || x.category === filter.category) &&
      (filter.resolved == null || x.resolved === filter.resolved) &&
      (!filter.severity || x.severity === filter.severity));
  }
  function recent(n) { return load().slice(0, n || 10); }
  function unresolved() { return load().filter(x => !x.resolved); }

  function resolve(id) {
    const x = load().find(e => e.id === id);
    if (x) { x.resolved = true; persist(); }
    return x || null;
  }
  function clear() { _log = []; persist(); }

  function counts() {
    const by = { total: 0, unresolved: 0 };
    CATEGORIES.forEach(c => (by[c] = 0));
    load().forEach(e => { by.total++; if (!e.resolved) by.unresolved++; by[e.category] = (by[e.category] || 0) + 1; });
    return by;
  }

  return { STORAGE_KEY, CATEGORIES, SEVERITIES, record, list, recent, unresolved, resolve, clear, counts };
})();
