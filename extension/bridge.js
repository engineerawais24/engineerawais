/* ============================================================
   Bridge — CareerPilot app page → extension background (Queue → ATS Autofill).

   Runs on the CareerPilot app page served from localhost / 127.0.0.1. It is the
   ONE place that lets the local app — which has no chrome.* APIs — reach the
   extension WITHOUT a backend:

     • The Application Queue posts a `window.postMessage` { __careerpilot, kind:
       'queue-open', url, token, jobId, profile, resume }. The bridge forwards it
       to the background service worker (chrome.runtime.sendMessage), which stores
       the one-shot intent + payload the ATS tab reads. It then posts an ACK back
       so the app can confirm the extension is connected.

     • When the ATS tab writes `cp_needs_attention`, the bridge relays it to the
       app as a `window.postMessage` { kind: 'needs-attention' } so the Queue flags
       the job.

   WHY window.postMessage and not a CustomEvent: a CustomEvent's `detail` object
   does NOT cross from the page's main world into this content script's isolated
   world (it reads back as null), so the queue signal never arrived — that was the
   bug. window.postMessage is structured-cloned and crosses worlds reliably.

   No website localStorage, no network, no file:// dependency. The bridge also
   records a "loaded" marker + the last queue event it saw, so the popup can show
   exactly where the chain breaks. See background.js for the storage side.
   ============================================================ */

(function () {
  'use strict';

  const ORIGIN = (function () { try { return window.location.origin; } catch (e) { return ''; } })();
  const HREF   = (function () { try { return window.location.href; } catch (e) { return ''; } })();

  function put(obj) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set(obj);
    } catch (e) { /* storage unavailable — the diagnostic just won't update */ }
  }

  /* record that this content script actually loaded on this page. The popup
     reads it to show "bridge: loaded" for the app's origin. No isCareerPilot
     guard: we always listen (harmless) and only ACT on our own signed messages,
     so the bridge is guaranteed to be live on the app page. */
  put({ cp_bridge_status: { loaded: true, origin: ORIGIN, href: HREF, ts: Date.now() } });

  function sendToBackground(message) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(message, function (resp) {
          void (chrome.runtime.lastError);
          /* ACK back to the page so the app can confirm the extension received it */
          try {
            window.postMessage({ __careerpilot_from_ext: true, kind: 'queue-open-ack',
              ok: !!(resp && resp.ok), token: message.token }, ORIGIN || '*');
          } catch (e) { /* no window */ }
        });
        return true;
      }
    } catch (e) { /* extension context gone — auto-apply simply won't fire */ }
    return false;
  }

  /* app → extension: the CareerPilot page posts a signed queue-open message */
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;                       // only our own window
    const d = ev.data;
    if (!d || d.__careerpilot !== true || d.kind !== 'queue-open') return;
    if (!d.url || !d.token) return;
    put({ cp_last_queue_event: { url: d.url, token: d.token, jobId: d.jobId || null, ts: Date.now() } });
    sendToBackground({
      type: 'cp-queue-open',
      url: d.url, token: d.token, jobId: d.jobId || null,
      profile: d.profile || null, resume: d.resume || null,
    });
  });

  /* extension → app: relay a blocker back to the page via postMessage */
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes.cp_needs_attention) return;
        const v = changes.cp_needs_attention.newValue;
        if (v) {
          try { window.postMessage({ __careerpilot_from_ext: true, kind: 'needs-attention', detail: v }, ORIGIN || '*'); }
          catch (e) { /* no window */ }
        }
      });
    }
  } catch (e) { /* no storage events — needs-attention just won't round-trip */ }
})();
