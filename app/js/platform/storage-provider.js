/* ============================================================
   StorageProvider — the backend-ready storage abstraction
   (Sprint 14 PART 1 & 9).

   THE CONTRACT every provider implements:
     get(key)          → parsed value | null
     set(key, value)   → { ok, error? }
     remove(key)       → { ok, error? }
     list()            → [logical keys in this namespace]
     clear()           → { ok }          (namespace-scoped ONLY)
     transaction(fn)   → { ok, result?, error? }  (snapshot+rollback)
     healthCheck()     → { ok, provider, configured, writable?, keys?, bytes?, note?, error? }

   BACKWARD COMPATIBILITY (PART 9): the default LocalStorageProvider
   is bound to a NAMESPACE ('careerpilot_platform.'). It only ever
   reads/writes/clears keys under that prefix, so the existing app's
   localStorage keys (profile, applications, prep, submissions,
   interview memory, …) are never touched, renamed or cleared.

   Only the new Sprint 14 modules use AppStorage; existing modules
   keep talking to localStorage directly (no risky mass rewrite).

   The REST / PostgreSQL / Supabase / Firebase providers are
   INTERFACE-ONLY here — they expose the same method names and a
   documented config shape, but no real database is connected.
   ============================================================ */

const StorageProviders = (() => {

  /* ---------- the working default: LocalStorageProvider ---------- */
  function localProvider(opts) {
    const ns = (opts && opts.namespace) || 'careerpilot_platform.';
    const full = k => ns + k;
    const isOurs = k => typeof k === 'string' && k.indexOf(ns) === 0;

    function get(key) {
      try { const raw = localStorage.getItem(full(key)); return raw == null ? null : JSON.parse(raw); }
      catch (e) { return null; }
    }
    function set(key, value) {
      try { localStorage.setItem(full(key), JSON.stringify(value)); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    function remove(key) {
      try { localStorage.removeItem(full(key)); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    function list() {
      const out = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isOurs(k)) out.push(k.slice(ns.length)); } }
      catch (e) { /* ignore */ }
      return out;
    }
    /* namespace-scoped ONLY — never a blind localStorage.clear() */
    function clear() { list().forEach(k => remove(k)); return { ok: true }; }

    function transaction(fn) {
      const keys = list();
      const snap = {};
      keys.forEach(k => { snap[k] = localStorage.getItem(full(k)); });
      try {
        const result = fn(api);
        return { ok: true, result };
      } catch (e) {
        /* rollback: restore the namespace to its pre-transaction state */
        list().forEach(k => remove(k));
        Object.keys(snap).forEach(k => { if (snap[k] != null) { try { localStorage.setItem(full(k), snap[k]); } catch (_) {} } });
        return { ok: false, error: e.message };
      }
    }

    function healthCheck() {
      try {
        const probe = full('__probe__');
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        const keys = list();
        let bytes = 0;
        keys.forEach(k => { const v = localStorage.getItem(full(k)); bytes += v ? v.length : 0; });
        return { ok: true, provider: 'local', configured: true, writable: true, keys: keys.length, bytes, namespace: ns };
      } catch (e) {
        return { ok: false, provider: 'local', configured: true, writable: false, error: e.message };
      }
    }

    const api = { name: 'LocalStorageProvider', kind: 'local', namespace: ns, configured: true, get, set, remove, list, clear, transaction, healthCheck };
    return api;
  }

  /* ---------- interface-only remote providers (no DB connected) ----------
     Each documents the config a real implementation will need and
     satisfies the interface so it can be swapped in and health-checked
     without crashing the admin screen. Data methods throw by design. */
  function stub(kind, label, contract, opts) {
    const notReady = () => { throw new Error(`${label} provider is interface-only in this build — no backend connected.`); };
    return {
      name: `${label}StorageProvider`, kind, configured: false, contract, config: opts || {},
      get: notReady, set: notReady, remove: notReady, list: notReady, clear: notReady, transaction: notReady,
      healthCheck: () => ({ ok: false, provider: kind, configured: false, note: `${label} interface prepared; connect a backend to enable.`, contract }),
    };
  }
  /* REAL RESTStorageProvider (Sprint 16 PART 5). Backs the sync
     StorageProvider interface with a LOCAL MIRROR (so reads stay
     synchronous and offline keeps working) while pushing writes to
     the FastAPI /api/kv endpoint in the background. If the backend is
     unreachable the write stays in the mirror and is queued on
     SyncManager — local data is never lost. Created WITHOUT a baseUrl
     it reports configured:false (so the Sprint 14 harness, which
     treats it as interface-only, still passes). */
  function restProvider(opts) {
    opts = opts || {};
    const baseUrl = opts.baseUrl || '';
    const configured = !!baseUrl;
    const ns = opts.namespace || 'careerpilot_platform.';
    const mirror = localProvider({ namespace: ns });
    const client = opts.client || (typeof APIClient !== 'undefined' ? APIClient : null);
    const transport = opts.transport || null;
    const META_KEY = '__kvmeta';
    let reachable = configured ? null : false;
    let hydration = null;          // last hydration result

    const kvUrl = key => baseUrl + '/api/kv/' + encodeURIComponent(key);
    const dataKeys = () => mirror.list().filter(k => k !== META_KEY);

    /* per-key sync metadata: when it was written locally and whether
       that write has been confirmed by the backend (Sprint 17). */
    function meta() { return mirror.get(META_KEY) || {}; }
    function saveMeta(m) { mirror.set(META_KEY, m); }
    function markLocal(key) { const m = meta(); m[key] = { localUpdatedAt: Date.now(), synced: false }; saveMeta(m); }
    function markSynced(key, backendUpdatedAt) {
      const m = meta();
      m[key] = Object.assign({}, m[key], { synced: true, syncedAt: Date.now(), backendUpdatedAt: backendUpdatedAt || null });
      saveMeta(m);
    }

    function push(method, key, value) {
      if (!configured || !client) return;
      const o = { transport, retries: 1, retryBackoffMs: 0, timeout: opts.timeout || 6000 };
      if (method === 'PUT') o.body = { value };
      client.request(method, kvUrl(key), o)
        .then(res => {
          reachable = true;
          if (method === 'PUT') markSynced(key, res && res.data && res.data.updated_at);
        })
        .catch(() => {
          reachable = false;   // offline: keep the mirror copy + queue for later
          if (typeof SyncManager !== 'undefined') {
            SyncManager.enqueue({ type: method === 'PUT' ? 'set' : 'delete', entity: 'kv', key, payload: value != null ? value : null, optimistic: true });
          }
        });
    }

    /* ---- async backend reads (never synchronous network) ---- */
    async function listRemote(o) {
      o = o || {};
      if (!configured || !client) throw new Error('backend not configured');
      const res = await client.request('GET', baseUrl + '/api/kv?prefix=' + encodeURIComponent(ns), { transport: o.transport || transport, retries: 0, timeout: o.timeout || 10000 });
      const d = res && res.data ? res.data : {};
      return (d.entries || (d.keys || []).map(k => ({ key: k, updated_at: null })));
    }
    async function getRemote(key, o) {
      o = o || {};
      if (!configured || !client) throw new Error('backend not configured');
      const res = await client.request('GET', kvUrl(key), { transport: o.transport || transport, retries: 0, timeout: o.timeout || 8000 });
      return res && res.data ? res.data : null;     // { key, value, updated_at }
    }

    /* HYDRATE: merge backend KV into the local mirror.
       • never deletes unknown local keys
       • never overwrites a NEWER unsynced local write (records a conflict)
       • on failure the app keeps using the mirror — no data loss */
    async function hydrate(o) {
      o = o || {};
      const started = Date.now();
      if (!configured || !client) {
        hydration = { at: Date.now(), ok: false, error: 'backend not configured' };
        return hydration;
      }
      try {
        const entries = await listRemote(o);
        const m = meta();
        let applied = 0, added = 0, skipped = 0, conflicted = 0;

        for (const e of entries) {
          const full = e.key;
          if (String(full).indexOf(ns) !== 0) continue;      // not our namespace
          const key = String(full).slice(ns.length);
          if (key === META_KEY) continue;

          const backendAt = e.updated_at ? Date.parse(e.updated_at) : 0;
          const lm = m[key];

          /* a local write that has NOT been confirmed by the backend and is
             at least as new as the backend copy WINS — keep local, record it */
          if (lm && lm.synced === false && (lm.localUpdatedAt || 0) >= backendAt) {
            skipped++; conflicted++;
            if (typeof ConflictCenter !== 'undefined') {
              ConflictCenter.record({
                entity: 'kv', key, kind: 'version',
                message: 'Local unsynced write is newer than the backend copy — local kept',
                local: { updatedAt: lm.localUpdatedAt, value: mirror.get(key) },
                backend: { updatedAt: e.updated_at },
              });
            }
            continue;
          }

          const remote = await getRemote(full, o);
          const existed = mirror.get(key) !== null;
          mirror.set(key, remote ? remote.value : null);
          m[key] = { localUpdatedAt: backendAt || Date.now(), synced: true, syncedAt: Date.now(), backendUpdatedAt: e.updated_at || null };
          applied++;
          if (!existed) added++;
        }

        saveMeta(m);
        reachable = true;
        hydration = { at: Date.now(), ok: true, applied, added, skipped, conflicts: conflicted, backendKeys: entries.length, durationMs: Date.now() - started };
        return hydration;
      } catch (err) {
        reachable = false;
        hydration = { at: Date.now(), ok: false, error: (err && err.message) || 'hydration failed' };
        return hydration;   // app continues on the mirror — nothing is lost
      }
    }

    /* backend vs local difference summary (async) */
    async function diff(o) {
      const entries = await listRemote(o || {});
      const remote = entries
        .map(e => String(e.key))
        .filter(k => k.indexOf(ns) === 0)
        .map(k => k.slice(ns.length))
        .filter(k => k !== META_KEY);
      const local = dataKeys();
      return {
        localCount: local.length,
        backendCount: remote.length,
        onlyLocal: local.filter(k => remote.indexOf(k) === -1),
        onlyBackend: remote.filter(k => local.indexOf(k) === -1),
        both: local.filter(k => remote.indexOf(k) !== -1),
      };
    }

    return {
      name: 'RESTStorageProvider', kind: 'rest', configured, namespace: ns, baseUrl,
      get: k => mirror.get(k),                                  // sync from mirror — always instant
      set: (k, v) => { const r = mirror.set(k, v); markLocal(k); push('PUT', k, v); return r; },
      remove: k => { const r = mirror.remove(k); const m = meta(); delete m[k]; saveMeta(m); push('DELETE', k); return r; },
      list: () => dataKeys(),
      clear: () => mirror.clear(),                              // mirror only — never mass-deletes the backend
      transaction: fn => mirror.transaction(fn),
      healthCheck: () => ({ ok: reachable !== false, provider: 'rest', configured, reachable, baseUrl, keys: dataKeys().length, hydration }),
      /* Sprint 17 async backend reads */
      hydrate, diff, getRemote, listRemote,
      hydration: () => hydration,
      meta,
    };
  }
  const postgresProvider = o => stub('postgres', 'PostgreSQL', { via: 'backend service', table: 'kv_store', columns: ['key', 'value', 'updated_at', 'user_id'] }, o);
  const supabaseProvider = o => stub('supabase', 'Supabase', { url: 'https://<project>.supabase.co', anonKeyRef: 'env:SUPABASE_ANON_KEY', table: 'kv_store', rls: true }, o);
  const firebaseProvider = o => stub('firebase', 'Firebase', { projectId: '<project>', service: 'firestore', collection: 'kv_store', authRequired: true }, o);

  const REGISTRY = {
    local: localProvider, rest: restProvider, postgres: postgresProvider,
    supabase: supabaseProvider, firebase: firebaseProvider,
  };

  function create(kind, opts) { return (REGISTRY[kind] || localProvider)(opts || {}); }

  return { create, kinds: Object.keys(REGISTRY) };
})();

/* ---------- AppStorage: the ACTIVE provider all new modules use ----------
   A stable delegating handle so the provider can be swapped at runtime
   (tests + a future backend) without any module holding a dead ref. */
const AppStorage = (() => {
  let active = StorageProviders.create('local', { namespace: 'careerpilot_platform.' });
  return {
    use(provider) { if (provider) active = provider; return active; },
    active() { return active; },
    name() { return active.name; },
    kind() { return active.kind; },
    get: k => active.get(k),
    set: (k, v) => active.set(k, v),
    remove: k => active.remove(k),
    list: () => active.list(),
    clear: () => active.clear(),
    transaction: fn => active.transaction(fn),
    healthCheck: () => active.healthCheck(),
  };
})();
