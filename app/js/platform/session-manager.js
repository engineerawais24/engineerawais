/* ============================================================
   SessionManager — session foundation (Sprint 14 PART 4).

   Today every user is an ANONYMOUS / LOCAL session — no login,
   no server. This prepares the shape a real authenticated
   session will take later without implementing auth:

     { mode: 'local' | 'authenticated',
       anonymousId, deviceId,
       accessToken, refreshToken,     // placeholders (null now)
       expiresAt,                     // null for local
       createdAt, lastActiveAt,
       user: null }

   Multiple-device readiness: a stable per-browser deviceId is
   minted and kept, so a future backend can reconcile sessions
   across devices. Persisted through AppStorage.
   ============================================================ */

const SessionManager = (() => {

  const STORAGE_KEY = 'session';
  let _session = null;

  const rid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function blankLocal() {
    return {
      mode: 'local',
      anonymousId: rid('anon'),
      deviceId: rid('dev'),
      accessToken: null,      // placeholder — set by a real login later
      refreshToken: null,     // placeholder
      expiresAt: null,        // local sessions never expire
      user: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
  }

  function load() {
    if (_session) return _session;
    const saved = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    _session = (saved && saved.mode) ? saved : blankLocal();
    return _session;
  }
  function persist() { if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, _session); }

  /* ensure a session exists (called at boot); keeps the deviceId */
  function init() {
    const s = load();
    s.lastActiveAt = Date.now();
    persist();
    return s;
  }

  function current() { return load(); }
  function mode() { return load().mode; }
  function deviceId() { return load().deviceId; }
  function accessToken() { return load().accessToken; }   // auth placeholder

  function isAuthenticated() { return load().mode === 'authenticated' && !isExpired(); }
  function isExpired() {
    const s = load();
    return !!s.expiresAt && Date.now() > s.expiresAt;
  }

  /* PLACEHOLDER: a future login handshake calls this with real
     tokens. No network / credential handling exists yet. */
  function beginAuthenticated(tokens) {
    const s = load();
    s.mode = 'authenticated';
    s.accessToken = (tokens && tokens.accessToken) || null;
    s.refreshToken = (tokens && tokens.refreshToken) || null;
    s.expiresAt = (tokens && tokens.expiresAt) || (Date.now() + 3600e3);
    s.user = (tokens && tokens.user) || null;
    s.lastActiveAt = Date.now();
    persist();
    return s;
  }
  function refresh(tokens) {
    const s = load();
    if (tokens && tokens.accessToken) s.accessToken = tokens.accessToken;
    if (tokens && tokens.expiresAt) s.expiresAt = tokens.expiresAt;
    s.lastActiveAt = Date.now();
    persist();
    return s;
  }

  /* logout → drop tokens, fall back to a fresh local session
     (keeps the same deviceId for multi-device continuity) */
  function logout() {
    const dev = load().deviceId;
    _session = blankLocal();
    _session.deviceId = dev;
    persist();
    return _session;
  }

  return {
    STORAGE_KEY, init, current, mode, deviceId, accessToken,
    isAuthenticated, isExpired, beginAuthenticated, refresh, logout,
  };
})();
