/* ============================================================
   ConnectorBase — the job-source ADAPTER INTERFACE (Sprint 9A).

   Every job source (LinkedIn Jobs, Bayt, GulfTalent, Company
   Career Portals) is an adapter with this exact shape:

     {
       id, label,
       capabilities: { query, location, workMode, postedSince,
                       pagination, salary, sponsorshipFlags },
       requires:  string[]   — config fields live mode needs
                               ('endpoint' | 'apiKeyRef' | 'sessionRef'),
       fetch(SearchParams) → ConnectorResult
     }

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

  /* connector lifecycle states (requirement: all seven) */
  const STATES = {
    NOT_CONFIGURED: 'not_configured',
    READY: 'ready',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
    RATE_LIMITED: 'rate_limited',
    AUTH_REQUIRED: 'auth_required',
  };

  const STATE_LABELS = {
    not_configured: 'Not configured',
    ready: 'Ready',
    running: 'Running…',
    success: 'Success',
    failed: 'Failed',
    rate_limited: 'Rate limited',
    auth_required: 'Auth required',
    off: 'Off',
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

  function createAdapter(spec) {
    return {
      id: spec.id,
      label: spec.label,
      capabilities: spec.capabilities,
      requires: spec.requires,

      isConfigured() {
        return missingConfig(spec, ConnectorConfig.get(spec.id)).length === 0;
      },

      fetch(params = {}) {
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
      },
    };
  }

  return { STATES, STATE_LABELS, result, createAdapter };
})();
