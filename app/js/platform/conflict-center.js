/* ============================================================
   ConflictCenter — sync conflict record (Sprint 17 PART 4).

   NEITHER SIDE IS EVER DISCARDED. The LOCAL version always stays
   authoritative in the browser; the backend/losing version is kept
   here (with metadata) so it is visible in #/admin and can be
   reconciled later.

   Entry:
     { id, at, entity, key, kind, message, local, backend, resolved }

   kind:
     version     — same key, different content/timestamps
     duplicate   — backend already has this record
     provenance  — immutable record (submitted / interview.submitted)
                   differs on the backend → NEVER overwritten
     http_409    — backend returned a hard conflict

   Persisted through AppStorage; degrades to memory if storage fails.
   ============================================================ */

const ConflictCenter = (() => {

  const STORAGE_KEY = 'conflicts';
  const MAX = 200;
  const KINDS = ['version', 'duplicate', 'provenance', 'http_409'];
  let _log = null;

  function load() {
    if (_log) return _log;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _log = Array.isArray(saved) ? saved : [];
    return _log;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, _log); }

  function record(c) {
    const list = load();
    const entry = {
      id: 'cf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      entity: String(c.entity || 'unknown'),
      key: String(c.key || ''),
      kind: KINDS.indexOf(c.kind) !== -1 ? c.kind : 'version',
      message: String(c.message || 'Conflict detected'),
      local: c.local !== undefined ? c.local : null,      // ALWAYS preserved
      backend: c.backend !== undefined ? c.backend : null,
      resolved: false,
    };
    list.unshift(entry);
    if (list.length > MAX) list.length = MAX;
    persist();
    return entry;
  }

  function all() { return load().slice(); }
  function recent(n) { return load().slice(0, n || 10); }
  function unresolved() { return load().filter(c => !c.resolved); }
  function count() { return unresolved().length; }
  function counts() {
    const by = { total: load().length, unresolved: unresolved().length };
    KINDS.forEach(k => (by[k] = 0));
    load().forEach(c => { by[c.kind] = (by[c.kind] || 0) + 1; });
    return by;
  }
  function forEntity(entity) { return load().filter(c => c.entity === entity); }
  function resolve(id) {
    const c = load().find(x => x.id === id);
    if (c) { c.resolved = true; persist(); }
    return c || null;
  }
  function clear() { _log = []; persist(); }

  return { STORAGE_KEY, KINDS, record, all, recent, unresolved, count, counts, forEntity, resolve, clear };
})();
