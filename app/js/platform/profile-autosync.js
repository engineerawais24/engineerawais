/* ============================================================
   ProfileAutoSync — keep the BACKEND profile in step with the local one.

   The bug this fixes
   ------------------
   CareerPilot is local-first: the profile lives in localStorage
   (`careerpilot_profile_v1`) and only reaches the backend when the user
   opts into backend mode or runs a manual migration from #/admin. The
   Chrome extension, however, reads the BACKEND profile (GET /api/profile) —
   and that GET auto-creates an EMPTY Profile row. So with a full profile in
   the UI but nothing ever pushed, the extension read a blank row and
   reported "Your backend profile is empty."

   The fix
   -------
   Whenever the app loads (or the profile is saved) and the backend is
   reachable, UPSERT the local profile to the backend. It must be an upsert
   (PUT /api/profile + PUT /api/preferences), NOT the insert-only
   POST /api/migrate: the empty row the extension's own GET created already
   "exists", so an insert-only migration would skip it and the row would
   stay blank forever.

   Safe + backward compatible
   --------------------------
     • READ-ONLY on local data — never deletes or rewrites the local profile.
     • Best-effort + silent — never blocks the UI, never throws to callers.
     • One-time by default — a content hash is stored and the push repeats
       only when the profile actually changes, so it is not a per-load
       network hit (a "one-time migration" that self-heals on edit).
     • Runs in BOTH storage modes — this is a LOCAL-mode bug; backend mode
       already pushes via DomainSync, and a duplicate idempotent PUT is
       harmless.
     • Only ever pushes a REAL profile (name or email present). A blank /
       default profile is skipped, so a fresh install never overwrites a
       populated backend with emptiness.

   Reuses: Migration.buildBundle() (the same snake_cased shaping the manual
   migration already uses), APIClient, and the existing profile/preferences/
   employment endpoints. No new backend endpoint, no autofill change.
   ============================================================ */

const ProfileAutoSync = (() => {

  const FLAG_KEY = 'careerpilot_profile_backend_sync';   // { hash, at }

  /* the same read-only, snake_cased bundle the manual migration builds */
  function bundle() {
    return (typeof Migration !== 'undefined' && Migration.buildBundle) ? Migration.buildBundle() : null;
  }

  /* a profile worth syncing carries at least a name or an email — never
     push a blank/default profile over a populated backend */
  function hasRealProfile(b) {
    const p = b && b.profile;
    if (!p) return false;
    return !!((p.first_name || '').trim() || (p.last_name || '').trim() || (p.email || '').trim());
  }

  /* content hash over exactly what we push, so an edit re-triggers a sync */
  function hashOf(b) {
    const s = JSON.stringify({ profile: b.profile, preferences: b.preferences, employment: b.employment });
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  function loadFlag() { try { return JSON.parse(localStorage.getItem(FLAG_KEY)) || null; } catch (e) { return null; } }
  function saveFlag(f) { try { localStorage.setItem(FLAG_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ } }
  function clearFlag() { try { localStorage.removeItem(FLAG_KEY); } catch (e) { /* ignore */ } }

  function client() { return (typeof APIClient !== 'undefined') ? APIClient : null; }
  function base() { return (typeof Backend !== 'undefined') ? Backend.baseUrl() : ''; }

  async function req(method, path, body) {
    const c = client();
    if (!c) throw new Error('APIClient unavailable');
    const opts = { retries: 0, timeout: 12000 };     // never retry-storm a down backend
    if (body != null) opts.body = body;
    return c.request(method, base() + path, opts);
  }

  async function reachable() {
    if (typeof Backend === 'undefined' || !Backend.testConnection) return false;
    try { const s = await Backend.testConnection(); return !!(s && s.reachable); }
    catch (e) { return false; }
  }

  /* UPSERT profile + preferences; create employment rows (idempotent — a
     duplicate ext_id comes back 409, which we treat as already-synced). */
  async function push(b) {
    const out = { profile: false, preferences: false, employment: 0, errors: [] };

    try { await req('PUT', '/api/profile', b.profile); out.profile = true; }
    catch (e) { out.errors.push('profile: ' + ((e && e.message) || 'failed')); }

    if (b.preferences) {
      try { await req('PUT', '/api/preferences', b.preferences); out.preferences = true; }
      catch (e) { out.errors.push('preferences: ' + ((e && e.message) || 'failed')); }
    }

    for (const emp of (b.employment || [])) {
      try { await req('POST', '/api/employment', emp); out.employment++; }
      catch (e) {
        if (e && e.status === 409) out.employment++;            // already there — fine
        else out.errors.push('employment: ' + ((e && e.message) || 'failed'));
      }
    }
    return out;
  }

  /* The one-time (self-healing) sync. Never throws. `force` re-pushes even
     when the hash is unchanged (used by an explicit "sync now"). */
  async function maybeSync(opts) {
    opts = opts || {};
    try {
      const b = bundle();
      if (!hasRealProfile(b)) return { ok: false, skipped: true, reason: 'no non-empty local profile' };

      const hash = hashOf(b);
      const flag = loadFlag();
      if (!opts.force && flag && flag.hash === hash) {
        return { ok: true, skipped: true, reason: 'already synced', hash };   // no network on the common path
      }
      if (!(await reachable())) return { ok: false, skipped: true, reason: 'backend unreachable', hash };

      const res = await push(b);
      if (res.profile) saveFlag({ hash, at: Date.now() });      // mark done only if the profile landed
      return Object.assign({ ok: res.profile, skipped: false, synced: true, hash }, res);
    } catch (e) {
      return { ok: false, skipped: true, reason: (e && e.message) || 'error' };
    }
  }

  return { FLAG_KEY, maybeSync, push, hashOf, hasRealProfile, bundle, loadFlag, saveFlag, clearFlag };
})();
