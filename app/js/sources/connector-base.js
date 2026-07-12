/* ============================================================
   ConnectorBase — the job-source ADAPTER INTERFACE (9A → 11).

   Every job source (LinkedIn, Bayt, GulfTalent, Greenhouse,
   Lever, Workday, SmartRecruiters, Generic Company Careers) is
   an adapter with this exact shape:

     {
       id, label, authType,
       capabilities: { query, location, workMode, postedSince,
                       pagination, salary, sponsorshipFlags },
       requires:  string[]   — config fields live mode needs
                               ('endpoint' | 'apiKeyRef' | 'sessionRef'),

       — the Sprint 11 production contract (every adapter) —
       authenticate()        → { ok, state, authType, mode, error }
       searchJobs(params)    → ConnectorResult
       normalize(raw)        → NormalizedJob (JobSchema contract)
       validate(job)         → problems[]  ([] = valid)
       healthCheck()         → { id, label, health, lastRun,
                                 lastSuccess, jobsFound, retryCount,
                                 rateLimitedUntil, error }
         health ∈ healthy | disabled | not_configured |
                  auth_required | rate_limited | error
       shutdown()            → { ok, id, released, note }
                               release resources at end of lifecycle

       fetch(SearchParams) → ConnectorResult   (9A alias of
                              searchJobs — kept for compatibility)
     }

   Nothing calls an adapter directly from the UI — execution,
   retries and logging are owned by ConnectorManager (Sprint 11).

   SearchParams (all optional):
     { query, location, workMode, postedSince: 'YYYY-MM-DD',
       page: 1-based, pageSize }

   ConnectorResult (standard for every adapter, demo or live):
     { ok, state, jobs: UnifiedJob[], page, pageSize, total,
       hasMore, error: string|null, retryAfter: ms|null }

   ---------------- BACKEND INTEGRATION CONTRACT ----------------
   Live connectors are implemented in the backend, never in the
   browser. The UI will call:

     POST {endpoint}/api/connectors/{id}/search
     body: SearchParams (JSON)

   The backend resolves credentials itself from its environment
   (the browser only ever stores REFERENCES like env:BAYT_API_KEY
   — see connector-config.js) and responds:

     200 → { ok:true, jobs:[UnifiedJob…], page, pageSize,
             total, hasMore }
     401/403 → mapped to state 'auth_required'
     429     → 'rate_limited' (+ Retry-After header → retryAfter)
     4xx/5xx → 'failed' (+ error message)

   Responses map 1:1 onto ConnectorResult, so replacing the
   liveFetch stub below with an async fetch() call is the ONLY
   change needed to go live — no UI changes.
   No scraping or login automation exists in this build.
   ============================================================ */

const ConnectorBase = (() => {

  /* connector lifecycle states. Sprint 15 adds OFFLINE + MAINTENANCE
     to the production status set (healthy is derived, not a run state). */
  const STATES = {
    NOT_CONFIGURED: 'not_configured',
    READY: 'ready',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    RATE_LIMITED: 'rate_limited',
    AUTH_REQUIRED: 'auth_required',
    OFFLINE: 'offline',
    MAINTENANCE: 'maintenance',
  };

  const STATE_LABELS = {
    not_configured: 'Not configured',
    ready: 'Ready',
    running: 'Running…',
    success: 'Success',
    failed: 'Failed',
    rate_limited: 'Rate limited',
    auth_required: 'Auth required',
    offline: 'Offline',
    maintenance: 'Maintenance',
    off: 'Off',
  };

  /* the seven production STATUSES a connector reports (PART 2) */
  const STATUS_LABELS = {
    healthy: 'Healthy',
    disabled: 'Disabled',
    offline: 'Offline',
    auth_required: 'Authentication Required',
    rate_limited: 'Rate Limited',
    maintenance: 'Maintenance',
    error: 'Error',
    not_configured: 'Not Configured',
  };

  function result(ok, state, extra = {}) {
    return Object.assign({
      ok, state, jobs: [], page: 1, pageSize: 0, total: 0,
      hasMore: false, error: null, retryAfter: null,
    }, extra);
  }

  /* live-mode stub — see BACKEND INTEGRATION CONTRACT above.
     Deliberately performs no network I/O in the UI-only build. */
  function liveFetch(spec, params, cfg) {
    return result(false, STATES.FAILED, {
      error: `Backend endpoint ${cfg.endpoint} is not reachable from the UI-only build — keep demo fallback on until the backend ships`,
    });
  }

  function missingConfig(spec, cfg) {
    return spec.requires.filter(k => !String(cfg[k] || '').trim());
  }

  /* demo-mode filtering: the same SearchParams work against the
     demo feed so every capability is real today */
  function applyParams(jobs, params) {
    let list = jobs;
    const q = String(params.query || '').toLowerCase().trim();
    if (q) {
      list = list.filter(j => {
        const hay = [j.title, j.company, j.description, (j.skills || []).join(' ')].join(' ').toLowerCase();
        return q.split(/\s+/).every(w => hay.includes(w));
      });
    }
    if (params.location) {
      const loc = String(params.location).toLowerCase();
      list = list.filter(j => j.location.toLowerCase().includes(loc) || /remote/i.test(j.location));
    }
    if (params.workMode) {
      list = list.filter(j => j.workMode === params.workMode);
    }
    if (params.postedSince) {
      list = list.filter(j => j.postedDate >= params.postedSince);
    }
    return list;
  }

  /* the core search — shared by fetch() (9A alias) and
     searchJobs() (Sprint 11 name). Pure over ConnectorConfig +
     the demo feed; live mode routes through the backend contract. */
  function runSearch(spec, params) {
    const cfg = ConnectorConfig.get(spec.id);

    /* dev/testing state simulation — drives the diagnostics UI */
    if (cfg.simulate === 'failed') {
      return result(false, STATES.FAILED, { error: 'Simulated connector failure' });
    }
    if (cfg.simulate === 'rate_limited') {
      return result(false, STATES.RATE_LIMITED, { error: 'Rate limited (simulated)', retryAfter: 15 * 60e3 });
    }
    if (cfg.simulate === 'auth_required') {
      return result(false, STATES.AUTH_REQUIRED, { error: 'Authentication required (simulated) — session expired' });
    }
    if (cfg.simulate === 'offline') {
      return result(false, STATES.OFFLINE, { error: 'Connector offline (simulated) — network unreachable' });
    }
    if (cfg.simulate === 'maintenance') {
      return result(false, STATES.MAINTENANCE, { error: 'Connector in scheduled maintenance (simulated)' });
    }

    if (!cfg.useDemo) {
      const missing = missingConfig(spec, cfg);
      if (missing.length) {
        return result(false, STATES.NOT_CONFIGURED, { error: 'Missing configuration: ' + missing.join(', ') });
      }
      return liveFetch(spec, params, cfg);
    }

    /* demo fallback (mock jobs stay available by requirement) */
    const all = applyParams(spec.demoFeed(), params);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Number(params.pageSize) || 25);
    const jobs = all.slice((page - 1) * pageSize, page * pageSize);
    return result(true, STATES.SUCCESS, {
      jobs, page, pageSize, total: all.length,
      hasMore: page * pageSize < all.length,
    });
  }

  /* healthCheck derives the connector's health from its config,
     the persisted board diagnostics and the sync log (Sprint 11
     diagnostics requirement: healthy / disabled / auth_required /
     rate_limited / error + last run / jobs found / retry count). */
  function deriveHealth(spec, cfg, board) {
    if (board && board.enabled === false) return 'disabled';
    if (cfg.simulate === 'offline') return 'offline';
    if (cfg.simulate === 'maintenance') return 'maintenance';
    if (cfg.simulate === 'rate_limited') return 'rate_limited';
    if (cfg.simulate === 'auth_required') return 'auth_required';
    if (cfg.simulate === 'failed') return 'error';
    if (!cfg.useDemo && missingConfig(spec, cfg).length) return 'not_configured';
    if (board) {
      if (board.state === 'failed') return 'error';
      if (board.state === 'offline') return 'offline';
      if (board.state === 'maintenance') return 'maintenance';
      if (board.state === 'rate_limited') return 'rate_limited';
      if (board.state === 'auth_required') return 'auth_required';
    }
    return 'healthy';
  }

  function createAdapter(spec) {
    return {
      id: spec.id,
      label: spec.label,
      authType: spec.authType || 'none',
      capabilities: spec.capabilities,
      requires: spec.requires,

      isConfigured() {
        return missingConfig(spec, ConnectorConfig.get(spec.id)).length === 0;
      },

      /* initialize() — prepare the connector before use (Sprint 15
         lifecycle). No-op in the demo build; a live connector would
         set up its HTTP client / SDK here. */
      initialize() {
        const cfg = ConnectorConfig.get(spec.id);
        return {
          ok: true, id: spec.id, mode: cfg.useDemo ? 'demo' : 'live',
          note: cfg.useDemo ? 'Demo connector ready — no setup needed'
            : 'Live client is initialized by the backend, not the browser',
        };
      },

      /* rateLimit() — current rate-limit posture, delegated to the
         centralized RateLimitManager (Sprint 15). */
      rateLimit() {
        if (typeof RateLimitManager !== 'undefined') return RateLimitManager.status(spec.id);
        return { id: spec.id, count: 0, quota: null, remaining: null, cooldownUntil: 0, backoffLevel: 0, inCooldown: false };
      },

      /* ---- Sprint 11 production contract (every adapter) ---- */

      /* authenticate() — resolve the connector's auth posture.
         Demo mode needs no auth; live mode reports whether the
         backend could authenticate (it never runs in the browser). */
      authenticate() {
        const cfg = ConnectorConfig.get(spec.id);
        /* the adapter's intrinsic auth type is authoritative unless
           the user explicitly overrode it to another real type */
        const authType = (cfg.authType && cfg.authType !== 'none')
          ? cfg.authType : (spec.authType || 'none');
        if (cfg.simulate === 'auth_required') {
          return { ok: false, state: STATES.AUTH_REQUIRED, authType, mode: 'live',
            error: 'Authentication required (simulated) — session expired' };
        }
        if (cfg.useDemo) {
          return { ok: true, state: STATES.READY, authType, mode: 'demo', error: null };
        }
        const missing = missingConfig(spec, cfg);
        if (missing.length) {
          return { ok: false, state: STATES.NOT_CONFIGURED, authType, mode: 'live',
            error: 'Missing configuration: ' + missing.join(', ') };
        }
        return { ok: false, state: STATES.AUTH_REQUIRED, authType, mode: 'live',
          error: 'Live authentication is performed by the backend — not reachable from the UI-only build' };
      },

      /* searchJobs(params) → ConnectorResult (the production name) */
      searchJobs(params = {}) {
        return runSearch(spec, params);
      },

      /* fetch(params) — 9A alias of searchJobs, kept for compatibility */
      fetch(params = {}) {
        return runSearch(spec, params);
      },

      /* normalize(raw) → NormalizedJob. Each adapter maps its
         board-native record with its own normalizer; the fallback
         is the schema's generic normalizer. */
      normalize(raw) {
        if (typeof spec.normalize === 'function') return spec.normalize(raw);
        return (typeof JobSchema !== 'undefined') ? JobSchema.normalized(raw) : raw;
      },

      /* validate(job) → problems[] ([] = valid) against JobSchema */
      validate(job) {
        return (typeof JobSchema !== 'undefined') ? JobSchema.validate(job) : [];
      },

      /* healthCheck() → structured diagnostics for this connector */
      healthCheck() {
        const cfg = ConnectorConfig.get(spec.id);
        const board = (typeof SourcesStore !== 'undefined')
          ? (SourcesStore.load().boards[spec.id] || null) : null;
        const retryCount = (typeof SyncLog !== 'undefined') ? SyncLog.retryCountOf(spec.id) : 0;
        const health = deriveHealth(spec, cfg, board);
        const lastSuccess = board ? board.lastSuccess
          : ((typeof SyncLog !== 'undefined') ? SyncLog.lastSuccessOf(spec.id) : null);
        const an = (typeof ConnectorAnalytics !== 'undefined') ? ConnectorAnalytics.summary(spec.id) : null;
        return {
          id: spec.id,
          label: spec.label,
          health,
          /* Sprint 15 status set + expanded diagnostics */
          status: health,
          statusLabel: STATUS_LABELS[health] || health,
          lastRun: board ? board.lastRun : null,
          lastSuccess,
          lastSuccessfulSearch: lastSuccess,
          jobsFound: board && board.jobsFound != null ? board.jobsFound : null,
          jobsRetrieved: an ? an.searched : (board && board.jobsFound != null ? board.jobsFound : null),
          retryCount,
          retries: retryCount,
          avgResponseTime: an ? an.avgResponseMs : null,
          successRate: an ? an.successRate : null,
          rateLimitedUntil: board ? (board.rateLimitedUntil || null) : null,
          error: board ? (board.lastError || null) : null,
          lastError: board ? (board.lastError || null) : null,
        };
      },

      /* shutdown() — release the connector's resources at the end
         of its lifecycle (close a live backend session / drop a
         cached token). In the UI-only demo build there is no live
         session to release, so this is a safe no-op that reports a
         clean teardown — the contract a live connector will honour. */
      shutdown() {
        const cfg = ConnectorConfig.get(spec.id);
        const live = !cfg.useDemo;
        return {
          ok: true, id: spec.id, released: live,
          note: live
            ? 'Live session release is performed by the backend on shutdown'
            : 'No live session in demo mode — nothing to release',
        };
      },
    };
  }

  return { STATES, STATE_LABELS, STATUS_LABELS, result, createAdapter, deriveHealth };
})();
