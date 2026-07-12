/* ============================================================
   APIClient — reusable HTTP client (Sprint 14 PART 2).

   Centralizes everything a real backend integration will need:
     • base URL + default headers
     • authentication placeholder (SessionManager access token)
     • per-request timeout (AbortController)
     • retry policy (retryable statuses / network errors, backoff)
     • structured errors { status, category, retryable, technical }
     • logging (failures → ErrorCenter, retries → Telemetry)
     • cancellation (AbortSignal)

   NO real endpoints are called. The transport is injectable
   (default = fetch); tests inject a fake transport to exercise
   retry / timeout / cancellation deterministically.

   Transport contract: transport(url, opts) → Promise resolving to
     { ok:boolean, status:number, statusText?, data? }  (or throws)
   ============================================================ */

const APIClient = (() => {

  const config = {
    baseUrl: '',
    headers: {},
    timeout: 15000,
    retries: 2,
    retryBackoffMs: 300,
    transport: null,           // default fetch used when null
  };
  let _last = null;            // last response summary (admin)

  function configure(patch) { Object.assign(config, patch || {}); return config; }

  function authHeader() {
    const t = (typeof SessionManager !== 'undefined') ? SessionManager.accessToken() : null;
    return t ? { Authorization: 'Bearer ' + t } : {};   // placeholder — null today
  }

  function structuredError(status, message, technical, retryable, category) {
    const e = new Error(message);
    e.__structured = true;
    e.status = status; e.retryable = !!retryable;
    e.category = category || 'api'; e.technical = technical != null ? technical : null;
    return e;
  }
  const isRetryable = status => status === 0 || status === 429 || status >= 500;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function defaultTransport(url, opts) {
    const r = await fetch(url, opts);
    let data = null; try { data = await r.json(); } catch (_) { /* non-JSON */ }
    return { ok: r.ok, status: r.status, statusText: r.statusText, data };
  }

  function withTimeout(promise, ms, controller) {
    if (!ms) return promise;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (controller) { try { controller.abort(); } catch (_) {} }
        reject(structuredError(0, `Request timed out after ${ms}ms`, null, true, 'timeout'));
      }, ms);
      Promise.resolve(promise).then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); });
    });
  }

  async function request(method, path, options) {
    const opts = options || {};
    const transport = opts.transport || config.transport || defaultTransport;
    const url = (config.baseUrl || '') + path;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, config.headers, authHeader(), opts.headers || {});
    const timeout = opts.timeout != null ? opts.timeout : config.timeout;
    const maxRetries = opts.retries != null ? opts.retries : config.retries;
    const backoff = opts.retryBackoffMs != null ? opts.retryBackoffMs : config.retryBackoffMs;
    const signal = opts.signal || null;
    const body = opts.body != null ? JSON.stringify(opts.body) : undefined;
    const total = Math.max(1, maxRetries + 1);

    let lastErr = null;
    for (let attempt = 1; attempt <= total; attempt++) {
      if (signal && signal.aborted) { lastErr = structuredError(0, 'Request cancelled', null, false, 'cancelled'); break; }
      const controller = (typeof AbortController !== 'undefined' && !signal) ? new AbortController() : null;
      const tk = (typeof Telemetry !== 'undefined') ? Telemetry.start('api_request') : null;
      try {
        const raw = await withTimeout(
          Promise.resolve(transport(url, { method, headers, body, signal: signal || (controller ? controller.signal : undefined) })),
          timeout, controller);
        if (tk) Telemetry.end(tk);
        const res = { ok: raw.ok !== false, status: raw.status || (raw.ok === false ? 500 : 200), statusText: raw.statusText, data: raw.data !== undefined ? raw.data : raw };
        _last = { ok: res.ok, status: res.status, method, path, at: Date.now() };
        if (res.ok) return res;
        lastErr = structuredError(res.status, res.statusText || ('HTTP ' + res.status), res.data, isRetryable(res.status), 'api');
      } catch (e) {
        if (tk) Telemetry.end(tk);
        lastErr = (e && e.__structured) ? e : structuredError(0, (e && e.message) || 'Network error', null, true, 'api');
        _last = { ok: false, status: lastErr.status, method, path, at: Date.now() };
      }
      const willRetry = lastErr.retryable && attempt < total;
      if (!willRetry) break;
      if (typeof Telemetry !== 'undefined') Telemetry.retry('api');
      if (backoff) await sleep(backoff * attempt);
    }

    if (typeof ErrorCenter !== 'undefined') {
      ErrorCenter.record({
        category: lastErr.category === 'timeout' ? 'api' : 'api',
        message: lastErr.message, source: `${method} ${path}`, severity: 'error',
        retryable: lastErr.retryable, technical: { status: lastErr.status, category: lastErr.category, detail: lastErr.technical },
      });
    }
    throw lastErr;
  }

  const get = (path, o) => request('GET', path, o);
  const post = (path, o) => request('POST', path, o);
  const put = (path, o) => request('PUT', path, o);
  const patch = (path, o) => request('PATCH', path, o);
  const del = (path, o) => request('DELETE', path, o);

  function status() {
    return {
      baseUrl: config.baseUrl || '(none — no backend configured)',
      timeout: config.timeout, retries: config.retries,
      authenticated: (typeof SessionManager !== 'undefined') ? SessionManager.isAuthenticated() : false,
      last: _last,
    };
  }

  return { configure, request, get, post, put, patch, delete: del, status, structuredError, isRetryable };
})();
