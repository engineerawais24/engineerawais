/* ============================================================
   SavedSearches — named search + filter presets for the Job Board
   (Sprint 19).

   Persisted through the EXISTING platform storage abstraction
   (AppStorage, Sprint 14–17), so it works in local mode and syncs
   to the backend in backend mode. It does NOT create its own
   localStorage key and never touches job, decision or application
   data.

   Entry: { id, name, filters, sort, createdAt, updatedAt }
   ============================================================ */

const SavedSearches = (() => {

  const STORAGE_KEY = 'saved_searches';
  const MAX = 25;

  /* always read through AppStorage — no in-memory cache, so a saved
     search survives a reload with no extra bookkeeping */
  function all() {
    const list = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    return Array.isArray(list) ? list : [];
  }
  function persist(list) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, list);
    return list;
  }

  const rid = () => 'ss-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const clean = v => JSON.parse(JSON.stringify(v == null ? null : v));

  function get(id) { return all().find(s => s.id === id) || null; }

  function save(name, filters, sort) {
    const label = String(name || '').trim();
    if (!label) return { ok: false, error: 'A saved search needs a name' };
    const list = all();
    if (list.length >= MAX) return { ok: false, error: `You can keep at most ${MAX} saved searches` };

    const entry = {
      id: rid(),
      name: label,
      filters: clean((typeof JobFilters !== 'undefined') ? JobFilters.normalize(filters) : (filters || {})),
      sort: sort || 'match',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.unshift(entry);
    persist(list);
    return { ok: true, entry };
  }

  function rename(id, name) {
    const label = String(name || '').trim();
    if (!label) return { ok: false, error: 'A saved search needs a name' };
    const list = all();
    const s = list.find(x => x.id === id);
    if (!s) return { ok: false, error: 'Saved search not found' };
    s.name = label;
    s.updatedAt = Date.now();
    persist(list);
    return { ok: true, entry: s };
  }

  function remove(id) {
    const list = all();
    const next = list.filter(s => s.id !== id);
    if (next.length === list.length) return { ok: false, error: 'Saved search not found' };
    persist(next);
    return { ok: true };
  }

  function clear() { persist([]); }

  return { STORAGE_KEY, MAX, all, get, save, rename, remove, clear };
})();
