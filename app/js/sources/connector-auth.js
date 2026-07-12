/* ============================================================
   ConnectorAuth — authentication strategy placeholders
   (Sprint 15 PART 4).

   Declares HOW each connector would authenticate against a real
   backend, and provides a placeholder authenticate() that reports
   posture WITHOUT ever performing a login, storing a credential,
   or scraping anything.

   Strategies (placeholders only):
     oauth    — OAuth2 access/refresh token references
     cookie   — session cookie captured server-side
     session  — backend-held login session
     api_key  — server-side API key reference
     none     — public endpoint, no auth

   Credentials NEVER live in the browser — only env:/secret:/vault:
   REFERENCES (see connector-config.js). Real auth is performed by
   the backend when it ships; this module only models the contract.
   ============================================================ */

const ConnectorAuth = (() => {

  const STRATEGIES = ['oauth', 'cookie', 'session', 'api_key', 'none'];

  /* one entry per supported connector (PART 4 list) */
  const REGISTRY = {
    linkedin:        { strategy: 'session',  requires: ['sessionRef'],                 note: 'Backend-held member session; no cookie scraping in the browser.' },
    bayt:            { strategy: 'api_key',  requires: ['endpoint', 'apiKeyRef'],       note: 'Server-side API key reference.' },
    gulftalent:      { strategy: 'api_key',  requires: ['endpoint', 'apiKeyRef'],       note: 'Server-side API key reference.' },
    greenhouse:      { strategy: 'none',     requires: ['endpoint'],                    note: 'Public Job Board API — no authentication.' },
    lever:           { strategy: 'none',     requires: ['endpoint'],                    note: 'Public Postings API — no authentication.' },
    workday:         { strategy: 'oauth',    requires: ['endpoint', 'oauthTokenRef'],   note: 'OAuth2 client-credentials handled by the backend.' },
    smartrecruiters: { strategy: 'api_key',  requires: ['endpoint', 'apiKeyRef'],       note: 'Server-side API key reference.' },
    careers:         { strategy: 'cookie',   requires: ['endpoint'],                    note: 'Employer portal session captured server-side.' },
  };

  function entry(id) { return REGISTRY[id] || { strategy: 'none', requires: [], note: 'Unknown connector — treated as public.' }; }
  function strategyFor(id) { return entry(id).strategy; }
  function requiresFor(id) { return entry(id).requires.slice(); }

  function missingRefs(id, cfg) {
    return entry(id).requires.filter(k => !String((cfg || {})[k] || '').trim());
  }

  /* placeholder authenticate — NEVER logs in. Reports the posture
     the integration layer + admin screen display. */
  function authenticate(id) {
    const meta = entry(id);
    const cfg = (typeof ConnectorConfig !== 'undefined') ? ConnectorConfig.get(id) : {};
    const base = { id, strategy: meta.strategy, note: meta.note };

    if (meta.strategy === 'none') {
      return Object.assign(base, { ok: true, state: 'ready', mode: cfg.useDemo ? 'demo' : 'live', reason: 'No authentication required' });
    }
    if (cfg.useDemo) {
      return Object.assign(base, { ok: true, state: 'ready', mode: 'demo', reason: 'Demo mode — no authentication performed' });
    }
    const missing = missingRefs(id, cfg);
    if (missing.length) {
      return Object.assign(base, { ok: false, state: 'not_configured', mode: 'live', reason: 'Missing configuration reference(s): ' + missing.join(', ') });
    }
    /* references present, but the browser never authenticates */
    return Object.assign(base, { ok: false, state: 'auth_required', mode: 'live', reason: `Backend performs ${meta.strategy} authentication — no credentials in the browser` });
  }

  function status(id) {
    const a = authenticate(id);
    return { id, strategy: a.strategy, state: a.state, mode: a.mode, ok: a.ok, reason: a.reason };
  }
  function statusAll(ids) { return (ids || Object.keys(REGISTRY)).map(status); }

  return { STRATEGIES, REGISTRY, strategyFor, requiresFor, missingRefs, authenticate, status, statusAll };
})();
