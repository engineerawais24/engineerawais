/* ============================================================
   CareerPilot Helper — background service worker (MV3).

   The RELIABLE path for Queue → ATS Auto Autofill. The CareerPilot app page
   runs either on localhost (a real http origin) or as a file:// page; either
   way it has no chrome.* APIs, so it dispatches a DOM event that the page's
   bridge content script forwards here as a runtime message. This worker is the
   single authority that records the one-shot queue intent + autofill payload in
   chrome.storage.local, which the ATS tab's auto-apply content script reads.

   This replaces the old file://-only storage bridge (which never loaded when
   the app was served from localhost, so the intent was never stored and the
   ATS form stayed empty). Nothing here reads website storage or the network.
   ============================================================ */

(function () {
  'use strict';

  const PENDING = 'cp_queue_pending';    // { url, token, jobId, ts }  — the one-shot intent
  const DATA    = 'cp_autofill_data';    // { profile, resume, ts }    — the autofill payload
  const SIGNAL  = 'cp_queue_signal_log'; // { token, url, jobId, ts }  — diagnostic: intent received here
  const STATUS  = 'cp_autofill_status';  // written by the ATS tab; the popup reads it

  function chromeSet(obj) {
    return new Promise(resolve => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
          chrome.storage.local.set(obj, () => resolve({ ok: !chrome.runtime.lastError }));
        else resolve({ ok: false });
      } catch (e) { resolve({ ok: false }); }
    });
  }

  /* pure + testable: the object to store for a queue-open message, or null if
     the message is malformed (no url/token → nothing is stored) */
  function intentFrom(msg, now) {
    if (!msg || msg.type !== 'cp-queue-open' || !msg.url || !msg.token) return null;
    const ts = now || Date.now();
    return {
      [PENDING]: { url: msg.url, token: msg.token, jobId: msg.jobId || null, ts },
      [DATA]:    { profile: msg.profile || null, resume: msg.resume || null, ts },
      [SIGNAL]:  { token: msg.token, url: msg.url, jobId: msg.jobId || null, ts },
    };
  }

  /* handle one runtime message. ctx.set(obj)->Promise and ctx.now are injectable
     for tests; in production they default to chrome.storage.local + Date.now(). */
  async function handleMessage(msg, ctx) {
    ctx = ctx || {};
    const set = ctx.set || chromeSet;
    const now = ctx.now || Date.now();
    if (!msg || !msg.type) return { ok: false, error: 'no message' };

    if (msg.type === 'cp-queue-open') {
      const obj = intentFrom(msg, now);
      if (!obj) return { ok: false, error: 'missing url/token' };
      await set(obj);
      return { ok: true, stored: true, token: msg.token };
    }

    return { ok: false, error: 'unknown message' };
  }

  /* register the listener only inside a real extension worker (a stubbed chrome
     in a test harness has no runtime.id, so this never fires there) */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      handleMessage(msg).then(sendResponse).catch(() => sendResponse({ ok: false }));
      return true;   // response is async
    });
  }

  const api = { handleMessage, intentFrom, PENDING, DATA, SIGNAL, STATUS };
  if (typeof self !== 'undefined') self.CPBackground = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
