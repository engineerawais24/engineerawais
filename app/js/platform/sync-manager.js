/* ============================================================
   SyncManager — offline-first change queue (Sprint 14 PART 3).

   Records local changes as operations and (when a backend exists)
   flushes them in order. With no backend the app stays fully
   functional: operations are queued and PRESERVED, never lost.

   Operation:
     { id, type:'set'|'delete'|'custom', entity, key, payload,
       baseVersion,           // for conflict detection
       optimistic,            // applied locally already
       status:'pending'|'failed'|'done'|'dead',
       attempts, conflict, createdAt, updatedAt, lastError }

   State (persisted via AppStorage):
     { queue:[], history:[], lastSync, online }

   • optimistic updates — enqueue flags the op; the caller has
     already updated local state, so the UI never blocks on sync
   • conflict detection — server baseVersion mismatch → op parked
   • offline mode — online:false (default; no backend) → flush is a
     safe no-op that keeps the queue intact
   • retry queue — failed ops stay queued; retry() re-arms them
   • failed operation history — dead ops (max attempts) move to
     history for the admin screen
   ============================================================ */

const SyncManager = (() => {

  const STORAGE_KEY = 'sync';
  const MAX_ATTEMPTS = 5;
  const MAX_HISTORY = 100;
  let _state = null;

  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && Array.isArray(saved.queue)) ? saved
      : { queue: [], history: [], lastSync: null, online: false };
    return _state;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, load()); }

  const rid = () => 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

  function enqueue(op) {
    const s = load();
    const entry = {
      id: rid(),
      type: op.type || 'set',
      entity: op.entity || null,
      key: op.key || null,
      payload: op.payload != null ? op.payload : null,
      baseVersion: op.baseVersion != null ? op.baseVersion : null,
      optimistic: !!op.optimistic,
      status: 'pending',
      attempts: 0,
      conflict: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastError: null,
    };
    s.queue.push(entry);
    persist();
    return entry;
  }

  function pending() { return load().queue.filter(o => o.status === 'pending' || o.status === 'failed'); }
  function failedOps() { return load().queue.filter(o => o.status === 'failed'); }
  function history() { return load().history.slice(); }
  function lastSync() { return load().lastSync; }
  function isOnline() { return load().online; }
  function setOnline(v) { const s = load(); s.online = !!v; persist(); return s.online; }
  function status() {
    const s = load();
    return { online: s.online, pending: pending().length, failed: failedOps().length, history: s.history.length, lastSync: s.lastSync };
  }

  /* a conflict is signalled explicitly by the server, or inferred
     when the server's CURRENT version (before applying) differs
     from the baseVersion the local change was made against. A
     successful write's new serverVersion is NOT a conflict. */
  function detectConflict(op, res) {
    if (res && res.conflict) return true;
    return op.baseVersion != null && res && res.currentVersion != null && res.currentVersion !== op.baseVersion;
  }

  function toHistory(s, op, finalStatus) {
    op.status = finalStatus;
    s.history.unshift(op);
    if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
  }

  /* flush the queue through a transport. Default: nothing to sync
     to (no backend) → offline no-op that preserves the queue. */
  async function flush(transport) {
    const s = load();
    if (!s.online) { return { skipped: true, online: false, pending: pending().length }; }
    const send = transport || (async () => { throw new Error('No backend connected'); });
    const tk = (typeof Telemetry !== 'undefined') ? Telemetry.start('sync') : null;
    let synced = 0, failed = 0, conflicts = 0;

    const active = s.queue.slice();
    for (const op of active) {
      if (op.status === 'done' || op.status === 'dead') continue;
      op.attempts++; op.updatedAt = Date.now(); op.status = 'pending';
      try {
        const res = await send(op);
        if (detectConflict(op, res)) {
          op.conflict = true; op.status = 'failed'; op.lastError = 'Version conflict — server ahead of local';
          conflicts++;
          if (typeof ErrorCenter !== 'undefined') ErrorCenter.record({ category: 'sync', message: op.lastError, source: op.entity || op.type, severity: 'warning', retryable: true, technical: { opId: op.id, baseVersion: op.baseVersion, serverVersion: res && res.serverVersion } });
        } else if (res && res.ok) {
          synced++; toHistory(s, op, 'done'); s.queue = s.queue.filter(o => o.id !== op.id); s.lastSync = Date.now();
        } else {
          throw new Error((res && res.error) || 'Sync rejected');
        }
      } catch (e) {
        failed++; op.status = 'failed'; op.lastError = e.message;
        if (typeof ErrorCenter !== 'undefined') ErrorCenter.record({ category: 'sync', message: e.message, source: op.entity || op.type, severity: 'error', retryable: op.attempts < MAX_ATTEMPTS, technical: { opId: op.id, attempts: op.attempts } });
        if (op.attempts >= MAX_ATTEMPTS) { s.queue = s.queue.filter(o => o.id !== op.id); toHistory(s, op, 'dead'); }
      }
    }
    if (tk) Telemetry.end(tk);
    persist();
    return { skipped: false, synced, failed, conflicts, pending: pending().length, lastSync: s.lastSync };
  }

  /* re-arm failed (retryable) ops */
  function retry() {
    const s = load();
    let n = 0;
    s.queue.forEach(o => { if (o.status === 'failed') { o.status = 'pending'; o.conflict = false; n++; } });
    persist();
    return n;
  }
  function clear() { _state = { queue: [], history: [], lastSync: null, online: load().online }; persist(); }

  return {
    STORAGE_KEY, MAX_ATTEMPTS, enqueue, pending, failedOps, history,
    lastSync, isOnline, setOnline, status, flush, retry, clear, detectConflict,
  };
})();
