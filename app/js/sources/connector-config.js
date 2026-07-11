/* ============================================================
   ConnectorConfig — secure configuration placeholders (9A → 11).

   HARD RULE: no credentials in frontend code or storage. The
   browser stores only:
     endpoint        — the CareerPilot backend URL (https)
     apiKeyRef       — a REFERENCE to a backend secret,
                       e.g. 'env:BAYT_API_KEY' or 'secret:bayt/key'
     sessionRef      — a REFERENCE to backend-held session creds
     oauthTokenRef   — a REFERENCE to a backend-held OAuth access
                       token (OAuth2 connectors) — Sprint 11
     refreshTokenRef — a REFERENCE to a backend-held refresh token
                       (OAuth2 connectors) — Sprint 11
     authType        — 'none'|'api_key'|'oauth2'|'session'|'basic'
     rateLimit       — max requests/min the backend should honour
     retryMax        — retry-policy attempts on a failed run
     retryBackoffMs  — base backoff between retries
     timeoutMs       — per-request timeout the backend should apply
     useDemo         — demo fallback on/off (on by default)
     simulate        — dev-only state simulation for diagnostics

   Anything that does not look like a reference (env:/secret:/
   vault: prefix) is rejected at save time, so a pasted real
   API key / token can never be persisted. Numeric policy fields
   are coerced and clamped to safe ranges.
   ============================================================ */

const ConnectorConfig = (() => {

  const KEY = 'careerpilot_connector_cfg_v1';

  const REF_RE = /^(env|secret|vault):[A-Za-z0-9_./-]+$/;
  const SIMULATE = ['none', 'failed', 'rate_limited', 'auth_required'];
  const AUTH_TYPES = ['none', 'api_key', 'oauth2', 'session', 'basic'];

  /* production defaults for the retry / rate / timeout policy */
  const POLICY_DEFAULTS = { rateLimit: 60, retryMax: 2, retryBackoffMs: 1000, timeoutMs: 15000 };
  const POLICY_BOUNDS = {
    rateLimit:      { min: 0,    max: 100000 },
    retryMax:       { min: 0,    max: 5 },
    retryBackoffMs: { min: 0,    max: 60000 },
    timeoutMs:      { min: 1000, max: 120000 },
  };

  function clampInt(v, field) {
    const b = POLICY_BOUNDS[field];
    let n = Math.round(Number(v));
    if (!isFinite(n)) n = POLICY_DEFAULTS[field];
    return Math.min(b.max, Math.max(b.min, n));
  }

  function blank() {
    return {
      useDemo: true, endpoint: '', apiKeyRef: '', sessionRef: '', simulate: 'none',
      authType: 'none', oauthTokenRef: '', refreshTokenRef: '',
      rateLimit: POLICY_DEFAULTS.rateLimit, retryMax: POLICY_DEFAULTS.retryMax,
      retryBackoffMs: POLICY_DEFAULTS.retryBackoffMs, timeoutMs: POLICY_DEFAULTS.timeoutMs,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
      return {};
    }
  }

  function persist(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }

  function get(id) {
    return Object.assign(blank(), load()[id] || {});
  }

  function isRef(v) {
    return v === '' || REF_RE.test(v);
  }

  /* validated write — returns { ok, error } */
  function set(id, partial) {
    const cfg = get(id);
    const next = Object.assign({}, cfg, partial);

    /* every credential-bearing field must be a REFERENCE, never a value */
    for (const field of ['apiKeyRef', 'sessionRef', 'oauthTokenRef', 'refreshTokenRef']) {
      const v = String(next[field] || '').trim();
      if (!isRef(v)) {
        return { ok: false, error: `${field} must be a reference like env:NAME — never paste the actual credential` };
      }
      next[field] = v;
    }
    const ep = String(next.endpoint || '').trim();
    if (ep && !/^https:\/\/.+/i.test(ep)) {
      return { ok: false, error: 'Backend endpoint must be an https:// URL' };
    }
    next.endpoint = ep;
    if (!SIMULATE.includes(next.simulate)) next.simulate = 'none';
    if (!AUTH_TYPES.includes(next.authType)) next.authType = 'none';
    next.useDemo = !!next.useDemo;

    /* numeric policy fields — coerced + clamped to safe ranges */
    next.rateLimit = clampInt(next.rateLimit, 'rateLimit');
    next.retryMax = clampInt(next.retryMax, 'retryMax');
    next.retryBackoffMs = clampInt(next.retryBackoffMs, 'retryBackoffMs');
    next.timeoutMs = clampInt(next.timeoutMs, 'timeoutMs');

    const all = load();
    all[id] = next;
    persist(all);
    return { ok: true, config: next };
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, SIMULATE, AUTH_TYPES, POLICY_DEFAULTS, get, set, isRef, clear };
})();
