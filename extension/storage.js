/* ============================================================
   SafeStorage — a defensive wrapper over chrome.storage.local.

   Why this exists
   ---------------
   The popup caches the default résumé in chrome.storage.local. But
   `chrome.storage` is undefined whenever the "storage" permission isn't
   live — most commonly because the unpacked extension was updated but not
   RELOADED (chrome://extensions caches the loaded manifest). Reading
   `chrome.storage.local` then throws:
       "Cannot read properties of undefined (reading 'local')"

   SafeStorage never throws. When the real API is present it uses it; when
   it isn't, it transparently falls back to an in-memory store for the
   current popup session, so the UI keeps working (the résumé just doesn't
   persist across popup opens until the permission is live).

   Guarantees
   ----------
     • never throws, whatever the state of chrome/chrome.storage
     • reads chrome.runtime.lastError inside callbacks (no unchecked warnings)
     • NEVER uses website/page localStorage — the fallback is a private,
       in-memory object scoped to this extension context only
     • get/set/remove all return Promises; set/remove report `persisted`
       so the caller can tell the user when a value is session-only

   Cross-browser: prefers `chrome`, falls back to `browser` (Firefox).
   ============================================================ */

(function (global) {
  'use strict';

  /* session-only fallback — a private object, NOT localStorage */
  const memory = Object.create(null);

  /* the storage.local area, or null if the API isn't available */
  function area() {
    try {
      const api = (typeof chrome !== 'undefined' && chrome) ||
                  (typeof browser !== 'undefined' && browser) || null;
      return (api && api.storage && api.storage.local) ? api.storage.local : null;
    } catch (e) {
      return null;   // touching `chrome` in a hostile context must not throw
    }
  }

  function lastError() {
    try {
      const api = (typeof chrome !== 'undefined' && chrome) ||
                  (typeof browser !== 'undefined' && browser) || null;
      return (api && api.runtime && api.runtime.lastError) || null;
    } catch (e) {
      return null;
    }
  }

  function available() { return !!area(); }

  const fromMemory = key => (key in memory ? memory[key] : null);

  function get(key) {
    return new Promise(resolve => {
      const a = area();
      if (!a) { resolve(fromMemory(key)); return; }
      try {
        a.get(key, res => {
          if (lastError() || !res || res[key] === undefined) { resolve(fromMemory(key)); return; }
          resolve(res[key]);
        });
      } catch (e) {
        resolve(fromMemory(key));
      }
    });
  }

  function set(key, value) {
    return new Promise(resolve => {
      memory[key] = value;                         // always keep a session copy
      const a = area();
      if (!a) { resolve({ ok: true, persisted: false }); return; }
      try {
        a.set({ [key]: value }, () => {
          const err = lastError();
          resolve({ ok: !err, persisted: !err });
        });
      } catch (e) {
        resolve({ ok: true, persisted: false });   // kept in memory only
      }
    });
  }

  function remove(key) {
    return new Promise(resolve => {
      delete memory[key];
      const a = area();
      if (!a) { resolve({ ok: true, persisted: false }); return; }
      try {
        a.remove(key, () => { lastError(); resolve({ ok: true, persisted: true }); });
      } catch (e) {
        resolve({ ok: true, persisted: false });
      }
    });
  }

  global.SafeStorage = { get, set, remove, available };
})(typeof self !== 'undefined' ? self : this);
