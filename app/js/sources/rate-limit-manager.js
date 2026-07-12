/* ============================================================
   RateLimitManager — centralized connector rate limiting
   (Sprint 15 PART 3).

   Protects every connector (and a future real backend) from
   abuse with:
     • daily request counters (per connector, reset each day)
     • connector quotas (default + per-connector override)
     • cooldown timers with EXPONENTIAL BACKOFF on failures
     • Retry-After support (server-specified cooldown wins)

   NO real API calls happen here — it only tracks intent so the
   integration layer can decide whether a search is allowed.
   Persisted through AppStorage (Sprint 14) with an in-memory
   fallback so it always works, even before the platform loads.
   ============================================================ */

const RateLimitManager = (() => {

  const STORAGE_KEY = 'ratelimit';
  const DEFAULTS = { dailyQuota: 500, backoffBaseMs: 1000, maxCooldownMs: 30 * 60 * 1000 };
  const _quota = {};              // per-connector quota overrides
  let _state = null;

  const dayKey = () => new Date().toISOString().slice(0, 10);
  const now = () => Date.now();

  function load() {
    if (_state) return _state;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _state = (saved && saved.connectors) ? saved : { connectors: {} };
    return _state;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, load()); }

  function entry(id) {
    const s = load();
    let e = s.connectors[id];
    if (!e) { e = s.connectors[id] = { dayKey: dayKey(), count: 0, cooldownUntil: 0, backoffLevel: 0, lastRequest: null }; }
    if (e.dayKey !== dayKey()) { e.dayKey = dayKey(); e.count = 0; }   // daily reset
    return e;
  }

  function quotaOf(id) { return _quota[id] != null ? _quota[id] : DEFAULTS.dailyQuota; }
  function configure(id, opts) { if (opts && opts.dailyQuota != null) _quota[id] = opts.dailyQuota; return quotaOf(id); }

  /* may this connector run a search right now? */
  function check(id) {
    const e = entry(id);
    const quota = quotaOf(id);
    if (e.cooldownUntil && now() < e.cooldownUntil) {
      return { allowed: false, reason: 'cooldown', retryAfterMs: e.cooldownUntil - now(), cooldownUntil: e.cooldownUntil, count: e.count, quota };
    }
    if (e.count >= quota) {
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      return { allowed: false, reason: 'quota', retryAfterMs: midnight.getTime() - now(), cooldownUntil: 0, count: e.count, quota };
    }
    return { allowed: true, reason: null, retryAfterMs: 0, cooldownUntil: e.cooldownUntil || 0, count: e.count, quota };
  }

  /* record one performed request against the daily counter */
  function record(id) {
    const e = entry(id);
    e.count++; e.lastRequest = now();
    persist();
    return e.count;
  }

  /* apply backoff after a failure / 429. A server Retry-After wins;
     otherwise cooldown grows exponentially (base·2^level). */
  function penalize(id, retryAfterMs) {
    const e = entry(id);
    e.backoffLevel = Math.min(10, (e.backoffLevel || 0) + 1);
    const backoff = Math.min(DEFAULTS.maxCooldownMs, DEFAULTS.backoffBaseMs * Math.pow(2, e.backoffLevel - 1));
    const cooldownMs = retryAfterMs != null ? retryAfterMs : backoff;
    e.cooldownUntil = now() + cooldownMs;
    persist();
    return { cooldownUntil: e.cooldownUntil, cooldownMs, backoffLevel: e.backoffLevel };
  }

  /* a successful search clears the backoff */
  function reset(id) {
    const e = entry(id);
    e.backoffLevel = 0; e.cooldownUntil = 0;
    persist();
    return e;
  }

  function status(id) {
    const e = entry(id);
    const quota = quotaOf(id);
    return {
      id, count: e.count, quota, remaining: Math.max(0, quota - e.count),
      cooldownUntil: e.cooldownUntil || 0, backoffLevel: e.backoffLevel || 0,
      inCooldown: !!(e.cooldownUntil && now() < e.cooldownUntil),
      lastRequest: e.lastRequest || null, dayKey: e.dayKey,
    };
  }
  function statusAll(ids) {
    const list = ids || Object.keys(load().connectors);
    return list.map(status);
  }
  function clear() { _state = { connectors: {} }; persist(); }

  return { STORAGE_KEY, DEFAULTS, configure, quotaOf, check, record, penalize, reset, status, statusAll, clear };
})();
