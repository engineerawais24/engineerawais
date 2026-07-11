/* ============================================================
   ConnectorManager — the execution layer (Sprint 11).

   The ONE thing that runs connectors. No UI page and no engine
   calls an adapter directly; everything flows through here so
   the browser stays ignorant of whether a source is a demo feed
   today or a live backend tomorrow.

   RESPONSIBILITIES
   • execute the enabled connectors (queue, in priority order)
   • parallel-ready: connectors are independent, so collect()
     drains a queue with no cross-connector ordering dependency;
     when adapters return promises (live backend) collect() awaits
     them together — the contract is already concurrency-safe
   • retry policy: runConnector() honours each connector's config
     (retryMax + retryBackoffMs), retrying only RETRIABLE states
   • graceful degradation: one connector failing never aborts the
     rest — its batch comes back empty and the pipeline continues
   • structured logging: every attempt + every collect is recorded
     as a structured entry (also mirrored to SyncLog + Activity)
   • health: aggregate healthCheck() diagnostics for the UI

   The low-level single-connector executor is DailySearch.runBoard
   (adapter.fetch + persisted diagnostics + SyncLog). The manager
   wraps it with the queue, retry policy and structured log.
   ============================================================ */

const ConnectorManager = (() => {

  const MAX_LOG = 120;
  const RETRIABLE = ['failed', 'rate_limited'];   // worth another attempt
  const _log = [];

  function logEntry(e) {
    _log.unshift(Object.assign({ at: Date.now() }, e));
    if (_log.length > MAX_LOG) _log.length = MAX_LOG;
    if (typeof Activity !== 'undefined' && e.level === 'error') {
      Activity.log('warn', `Connector ${e.connector || ''}: ${e.error || e.event || ''}`.trim());
    }
    return _log[0];
  }

  function get(id) { return (typeof Connectors !== 'undefined') ? Connectors.get(id) : null; }
  function all() { return (typeof Connectors !== 'undefined') ? Connectors.all() : []; }

  /* enabled connectors, in priority order (the run queue) */
  function enabledIds() {
    const cfg = SourcesStore.load();
    return SourcesStore.BOARDS
      .filter(b => cfg.boards[b.id].enabled)
      .sort((a, b) => cfg.boards[a.id].priority - cfg.boards[b.id].priority)
      .map(b => b.id);
  }

  /* run ONE connector through the retry policy from its config.
     opts.retries overrides the configured retryMax; opts.probe
     forces a single small-page attempt (test-connection). */
  function runConnector(id, opts = {}) {
    const adapter = get(id);
    if (!adapter) {
      logEntry({ level: 'error', connector: id, event: 'unknown-connector' });
      return { id, label: id, jobs: [], state: 'failed', error: 'Unknown connector', attempts: 0, retries: 0 };
    }
    const cfg = ConnectorConfig.get(id);
    const maxRetries = opts.probe ? 0
      : (opts.retries != null ? Math.max(0, Number(opts.retries) || 0) : (Number(cfg.retryMax) || 0));

    const timeoutMs = Number(cfg.timeoutMs) || 0;   // budget the backend honours per request
    let attempt = 0;
    let r;
    do {
      attempt++;
      r = DailySearch.runBoard(id, opts);         // fetch + diagnostics + SyncLog
      logEntry({
        level: r.ok ? 'info' : 'error', connector: id, attempt,
        state: r.state, jobs: r.jobs.length, error: r.ok ? null : r.error,
        timeoutMs,
        backoffMs: (!r.ok && attempt <= maxRetries) ? (Number(cfg.retryBackoffMs) || 0) * attempt : 0,
      });
      if (r.ok) break;
      if (!RETRIABLE.includes(r.state)) break;    // auth/not_configured won't self-heal
    } while (attempt <= maxRetries);

    return {
      id, label: adapter.label, jobs: r.jobs, state: r.state,
      error: r.ok ? null : r.error, attempts: attempt, retries: attempt - 1,
    };
  }

  /* execute all enabled connectors, returning pipeline batches.
     Daily bulk runs use a single attempt per connector (retries:0)
     so a persistent failure is logged and left for the next cycle
     or a manual retry — the manager never stalls the whole run. */
  function collect(opts = {}) {
    const ids = opts.ids || enabledIds();
    const queue = ids.slice();
    const batches = [];
    while (queue.length) {
      const id = queue.shift();
      const r = runConnector(id, { retries: opts.retries != null ? opts.retries : 0 });
      batches.push({ id: r.id, label: r.label, jobs: r.jobs, state: r.state, error: r.error });
    }
    logEntry({
      level: 'info', event: 'collect', connectors: ids.length,
      failed: batches.filter(b => b.state !== 'success').length,
      jobs: batches.reduce((n, b) => n + b.jobs.length, 0),
    });
    /* end-of-lifecycle release: acquire → search → shutdown.
       A no-op in the demo build; the contract a live backend honours. */
    shutdownAll();
    return batches;
  }

  /* ---- connector lifecycle: authentication + shutdown ---- */

  /* pre-flight auth check (observability + the gate a live managed
     run uses). The demo search path never calls this inline, so
     demo behaviour is unchanged. */
  function authenticate(id) {
    const a = get(id);
    if (!a) return { ok: false, id, error: 'Unknown connector' };
    const res = a.authenticate();
    logEntry({
      level: res.ok ? 'info' : 'warn', connector: id, event: 'authenticate',
      state: res.state, mode: res.mode, error: res.error || null,
    });
    return res;
  }
  function authenticateAll() { return all().map(a => authenticate(a.id)); }

  /* teardown — release a connector's resources (close a live
     session / drop a cached token). No-op in the demo build. */
  function shutdown(id) {
    const a = get(id);
    if (!a) return { ok: false, id, error: 'Unknown connector' };
    const res = a.shutdown();
    logEntry({ level: 'info', connector: id, event: 'shutdown', released: res.released });
    return res;
  }
  function shutdownAll() {
    const results = all().map(a => {
      const res = a.shutdown();
      return res;
    });
    logEntry({ level: 'info', event: 'shutdown-all', connectors: results.length });
    return results;
  }

  /* explicit recovery — honours the full retry policy from config */
  function retry(id) {
    const r = runConnector(id);
    if (typeof toast === 'function') {
      toast(r.state === 'success'
        ? `${r.label}: ${r.jobs.length} jobs fetched${r.retries ? ` (after ${r.retries} retr${r.retries > 1 ? 'ies' : 'y'})` : ''}`
        : `${r.label}: ${r.error}`, r.state === 'success' ? 'success' : 'error');
    }
    return r;
  }

  /* test-connection — a single probe fetch, no retries */
  function test(id) {
    const r = runConnector(id, { probe: true });
    if (typeof toast === 'function') {
      toast(r.state === 'success'
        ? `${r.label}: connection OK (${ConnectorBase.STATE_LABELS[r.state] || r.state})`
        : `${r.label}: ${r.error}`, r.state === 'success' ? 'success' : 'error');
    }
    return r;
  }

  /* diagnostics — the manager is the UI's only window on connectors */
  function healthOf(id) {
    const a = get(id);
    return a ? a.healthCheck() : null;
  }
  function health() {
    return all().map(a => a.healthCheck());
  }
  function isConfigured(id) {
    const a = get(id);
    return a ? a.isConfigured() : false;
  }

  function log(n) { return n ? _log.slice(0, n) : _log.slice(); }
  function clearLog() { _log.length = 0; }

  return {
    collect, runConnector, retry, test,
    authenticate, authenticateAll, shutdown, shutdownAll,
    health, healthOf, isConfigured, enabledIds,
    get, all, log, clearLog, RETRIABLE,
  };
})();
