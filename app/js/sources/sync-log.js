/* ============================================================
   SyncLog — connector run & error log (Sprint 10A).

   A connector failure must never stop the pipeline — it is
   RECORDED here instead. Every run of every connector appends
   one entry:

     {
       source:             board id ('linkedin', 'greenhouse'…)
       sourceLabel:        display name
       time:               epoch ms of the run
       ok:                 boolean
       state:              ConnectorBase state after the run
       error:              string|null
       jobs:               number of postings fetched (0 on failure)
       retryCount:         consecutive failures for this source
                           at the time of the run (0 = first try)
       lastSuccessfulSync: epoch ms of the source's last success
                           BEFORE this run (null = never)
     }

   The log is a capped ring buffer (newest first) persisted to
   localStorage. retryCount resets to 0 on success, so
   retryCountOf(id) is "how many times in a row has this source
   failed" — the retry/backoff signal a real scheduler needs.
   ============================================================ */

const SyncLog = (() => {

  const KEY = 'careerpilot_synclog_v1';
  const MAX_ENTRIES = 50;

  function blank() {
    return { entries: [], retries: {}, lastSuccess: {} };
  }

  function load() {
    const base = blank();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.entries)) base.entries = saved.entries;
      if (saved.retries && typeof saved.retries === 'object') base.retries = saved.retries;
      if (saved.lastSuccess && typeof saved.lastSuccess === 'object') base.lastSuccess = saved.lastSuccess;
    } catch (e) { /* corrupt → blank log, never breaks a run */ }
    return base;
  }

  function persist(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  /* record one connector run — called by DailySearch.runBoard */
  function record({ source, sourceLabel, ok, state, error, jobs }) {
    const log = load();
    const entry = {
      source,
      sourceLabel: sourceLabel || source,
      time: Date.now(),
      ok: !!ok,
      state: state || (ok ? 'success' : 'failed'),
      error: ok ? null : (error || 'Unknown error'),
      jobs: ok ? (jobs || 0) : 0,
      retryCount: log.retries[source] || 0,
      lastSuccessfulSync: log.lastSuccess[source] || null,
    };
    log.entries.unshift(entry);
    if (log.entries.length > MAX_ENTRIES) log.entries.length = MAX_ENTRIES;
    if (ok) {
      log.retries[source] = 0;
      log.lastSuccess[source] = entry.time;
    } else {
      log.retries[source] = (log.retries[source] || 0) + 1;
    }
    persist(log);
    return entry;
  }

  function entries(sourceId) {
    const all = load().entries;
    return sourceId ? all.filter(e => e.source === sourceId) : all;
  }

  /* consecutive failures — 0 means the last run succeeded */
  function retryCountOf(sourceId) {
    return load().retries[sourceId] || 0;
  }

  function lastSuccessOf(sourceId) {
    return load().lastSuccess[sourceId] || null;
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, MAX_ENTRIES, record, entries, retryCountOf, lastSuccessOf, clear };
})();
