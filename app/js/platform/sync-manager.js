/* ============================================================
   SyncManager — offline-first change queue (Sprint 14 PART 3)
   + LIVE BACKEND FLUSH (Sprint 17 PART 1).

   Records local changes as operations and drains them to the
   Sprint 16 backend when it is reachable. With no backend the app
   stays fully functional: operations are queued and PRESERVED.

   Operation:
     { id, type:'set'|'delete'|'custom', entity, key, payload,
       baseVersion, optimistic,
       status:'pending'|'failed'|'done'|'dead',
       attempts, retryCount, permanent, conflict,
       createdAt, updatedAt, lastError }

   State (persisted via AppStorage):
     { queue:[], history:[], lastSync, online,
       lastAttemptAt, lastSuccessAt, lastFailureAt }

   SPRINT 17 BEHAVIOUR
   • FIFO — the queue is drained in insertion order, deterministically.
   • An operation is removed ONLY after a confirmed backend success;
     failures stay queued.
   • Bounded retry: MAX_ATTEMPTS, after which the op moves to the
     failed-operation history ('dead').
   • PERMANENT failures (4xx validation/conflict) are marked
     `permanent` and are NOT retried automatically ever again — they
     stay visible in the queue for diagnostics until the user
     explicitly clicks Retry.
   • Conflicts (409 / version) are preserved: recorded on
     ConflictCenter and the local value is never discarded.
   • Concurrent flushes are prevented by an in-flight lock.
   • Flushing is async and never blocks normal frontend usage.

   The Sprint 14 contract (enqueue / pending / failedOps / retry /
   flush(transport) / offline no-op / conflict flag) is unchanged.
   ============================================================ */

const SyncManager = (() => {

  const STORAGE_KEY = 'sync';
  const MAX_ATTEMPTS = 5;
  const MAX_HISTORY = 100;
  /* 4xx that will never succeed by retrying the same payload */
  const PERMANENT_STATUSES = [400, 401, 403, 404, 409, 422];
  let _state = null;
  let _flushing = false;          // in-flight lock (prevents duplicate flushes)

  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && Array.isArray(saved.queue)) ? saved
      : { queue: [], history: [], lastSync: null, online: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
    if (_state.lastAttemptAt === undefined) _state.lastAttemptAt = null;
    if (_state.lastSuccessAt === undefined) _state.lastSuccessAt = null;
    if (_state.lastFailureAt === undefined) _state.lastFailureAt = null;
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
      retryCount: 0,
      permanent: false,
      conflict: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastError: null,
    };
    s.queue.push(entry);          // FIFO
    persist();
    return entry;
  }

  /* Sprint 14 contract: pending() includes failed (and permanent) ops
     that are still in the queue. retryable() excludes permanent ones. */
  function pending() { return load().queue.filter(o => o.status === 'pending' || o.status === 'failed'); }
  function failedOps() { return load().queue.filter(o => o.status === 'failed'); }
  function permanentOps() { return load().queue.filter(o => o.permanent); }
  function retryable() { return load().queue.filter(o => (o.status === 'pending' || o.status === 'failed') && !o.permanent); }
  function conflicts() { return load().queue.filter(o => o.conflict); }
  function history() { return load().history.slice(); }
  function lastSync() { return load().lastSync; }
  function isOnline() { return load().online; }
  function isFlushing() { return _flushing; }
  function setOnline(v) { const s = load(); s.online = !!v; persist(); return s.online; }

  function status() {
    const s = load();
    return {
      online: s.online,
      flushing: _flushing,
      pending: pending().length,              // Sprint 14 shape (includes failed)
      retryable: retryable().length,
      failed: failedOps().length,
      permanentFailed: permanentOps().length,
      conflicts: conflicts().length,
      history: s.history.length,
      lastSync: s.lastSync,
      lastAttemptAt: s.lastAttemptAt,
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
    };
  }

  /* a conflict is signalled explicitly by the server, or inferred when
     the server's CURRENT version differs from the op's baseVersion. */
  function detectConflict(op, res) {
    if (res && res.conflict) return true;
    return op.baseVersion != null && res && res.currentVersion != null && res.currentVersion !== op.baseVersion;
  }

  function toHistory(s, op, finalStatus) {
    op.status = finalStatus;
    s.history.unshift(op);
    if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
  }

  /* ---- the live backend transport (Sprint 17) ----
     Handles the two op families the app produces:
       entity 'kv'     → PUT/DELETE /api/kv/{key}   (RESTStorageProvider)
       entity 'domain' → payload {method, path, body} (DomainSync)
     Returns { ok } or { ok:false, error, status, conflict }. */
  function backendTransport(opts) {
    opts = opts || {};
    const client = (typeof APIClient !== 'undefined') ? APIClient : null;
    const base = () => (typeof Backend !== 'undefined') ? Backend.baseUrl() : (opts.baseUrl || '');
    return async (op) => {
      if (!client) return { ok: false, error: 'APIClient unavailable' };
      const o = { transport: opts.transport, retries: 0, timeout: opts.timeout || 8000 };
      try {
        if (op.entity === 'kv') {
          const url = base() + '/api/kv/' + encodeURIComponent(op.key);
          if (op.type === 'delete') { await client.request('DELETE', url, o); return { ok: true }; }
          o.body = { value: op.payload };
          await client.request('PUT', url, o);
          return { ok: true };
        }
        if (op.entity === 'domain' && op.payload && op.payload.method && op.payload.path) {
          o.body = op.payload.body;
          await client.request(op.payload.method, base() + op.payload.path, o);
          return { ok: true };
        }
        return { ok: false, error: 'Unsupported sync entity: ' + op.entity };
      } catch (e) {
        const st = e && e.status;
        return { ok: false, error: (e && e.message) || 'sync failed', status: st, conflict: st === 409 };
      }
    };
  }

  /* flush the queue through a transport (defaults to the live backend).
     Offline → safe no-op that preserves the queue. Concurrent calls are
     rejected with skipped:'in_progress'. */
  async function flush(transport) {
    if (_flushing) return { skipped: true, reason: 'in_progress', pending: pending().length };
    const s = load();
    if (!s.online) return { skipped: true, online: false, pending: pending().length };

    _flushing = true;
    const tk = (typeof Telemetry !== 'undefined') ? Telemetry.start('sync') : null;
    let synced = 0, failed = 0, conflicted = 0, skippedPermanent = 0;
    try {
      const send = transport || (async () => { throw new Error('No backend connected'); });
      s.lastAttemptAt = Date.now();

      const active = s.queue.slice();                 // FIFO snapshot
      for (const op of active) {
        if (op.status === 'done' || op.status === 'dead') continue;
        if (op.permanent) { skippedPermanent++; continue; }   // never auto-retried

        op.attempts++; op.retryCount = op.attempts; op.updatedAt = Date.now(); op.status = 'pending';
        try {
          const res = await send(op);

          if (detectConflict(op, res)) {
            /* CONFLICT — keep the op (and the local value); never discard */
            op.conflict = true; op.permanent = true; op.status = 'failed';
            op.lastError = (res && res.error) || 'Version conflict — backend ahead of local';
            conflicted++;
            s.lastFailureAt = Date.now();
            if (typeof ConflictCenter !== 'undefined') {
              ConflictCenter.record({
                entity: op.entity, key: op.key, kind: (res && res.status === 409) ? 'http_409' : 'version',
                message: op.lastError, local: op.payload,
                backend: { serverVersion: res && res.serverVersion, status: res && res.status },
              });
            }
            if (typeof ErrorCenter !== 'undefined') ErrorCenter.record({ category: 'sync', message: op.lastError, source: op.entity || op.type, severity: 'warning', retryable: false, technical: { opId: op.id, status: res && res.status } });

          } else if (res && res.ok) {
            /* removed ONLY after confirmed backend success */
            synced++;
            toHistory(s, op, 'done');
            s.queue = s.queue.filter(o => o.id !== op.id);
            s.lastSync = Date.now();
            s.lastSuccessAt = Date.now();

          } else {
            const err = new Error((res && res.error) || 'Sync rejected');
            err.status = res && res.status;
            throw err;
          }
        } catch (e) {
          failed++;
          op.status = 'failed';
          op.lastError = e.message;
          s.lastFailureAt = Date.now();
          const st = e && e.status;
          const isPermanent = st != null && PERMANENT_STATUSES.indexOf(st) !== -1;
          if (isPermanent) op.permanent = true;      // stop retrying forever
          if (typeof ErrorCenter !== 'undefined') {
            ErrorCenter.record({ category: 'sync', message: e.message, source: op.entity || op.type, severity: 'error', retryable: !isPermanent && op.attempts < MAX_ATTEMPTS, technical: { opId: op.id, attempts: op.attempts, status: st } });
          }
          if (!isPermanent && op.attempts >= MAX_ATTEMPTS) {
            s.queue = s.queue.filter(o => o.id !== op.id);
            toHistory(s, op, 'dead');               // failed-operation history
          }
        }
      }
      persist();
      return { skipped: false, synced, failed, conflicts: conflicted, skippedPermanent, pending: pending().length, lastSync: s.lastSync };
    } finally {
      if (tk) Telemetry.end(tk);
      _flushing = false;
    }
  }

  /* live flush against the Sprint 16 backend */
  async function flushNow(opts) {
    return flush(backendTransport(opts || {}));
  }

  /* re-arm failed ops — an EXPLICIT user action also clears the
     permanent flag (they asked for it) */
  function retry() {
    const s = load();
    let n = 0;
    s.queue.forEach(o => {
      if (o.status === 'failed') { o.status = 'pending'; o.conflict = false; o.permanent = false; n++; }
    });
    persist();
    return n;
  }
  function clear() {
    const online = load().online;
    _state = { queue: [], history: [], lastSync: null, online, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null };
    persist();
  }

  return {
    STORAGE_KEY, MAX_ATTEMPTS, PERMANENT_STATUSES,
    enqueue, pending, retryable, failedOps, permanentOps, conflicts, history,
    lastSync, isOnline, setOnline, isFlushing, status,
    flush, flushNow, backendTransport, retry, clear, detectConflict,
  };
})();
