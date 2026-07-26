/* ============================================================
   Bridge — CareerPilot app page ⇄ chrome.storage (Queue → ATS Auto Autofill).

   Runs on the CareerPilot app page only. It is the one place that lets the
   local app (a file:// page, which has no chrome.* APIs) talk to the
   extension, WITHOUT any backend:

     • When the Application Queue opens a job it dispatches a DOM event
       `careerpilot:queue-open` carrying { url, token, jobId, profile, resume }.
       The bridge forwards it into chrome.storage.local as the one-shot intent
       + autofill payload the ATS tab's auto-apply script reads.

     • When the ATS tab hits a login/CAPTCHA/blocked/no-form page it writes
       `cp_needs_attention`; the bridge relays that back to the app as a
       `careerpilot:needs-attention` DOM event so the Queue can flag the job.

   The bridge never reads the page's own data — the app hands it everything in
   the event detail, so the extension never touches website localStorage.
   ============================================================ */

(function () {
  'use strict';

  /* only bridge on the CareerPilot app page (this script can match any
     file:// page, so guard hard and do nothing everywhere else) */
  function isCareerPilot() {
    try {
      return /CareerPilot/i.test(document.title) || !!document.querySelector('.rail-logo, #nav, .shell');
    } catch (e) { return false; }
  }
  if (!isCareerPilot()) return;

  const PENDING = 'cp_queue_pending';
  const DATA = 'cp_autofill_data';
  const ATTN = 'cp_needs_attention';

  function store(obj) {
    try {
      if (typeof SafeStorage !== 'undefined') { Object.keys(obj).forEach(k => SafeStorage.set(k, obj[k])); return; }
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) chrome.storage.local.set(obj);
    } catch (e) { /* storage unavailable — auto-apply simply won't fire */ }
  }

  /* Queue opened a job → stash the intent + the autofill payload */
  document.addEventListener('careerpilot:queue-open', function (ev) {
    const d = (ev && ev.detail) || {};
    if (!d.url || !d.token) return;
    const ts = Date.now();
    store({
      [PENDING]: { url: d.url, token: d.token, jobId: d.jobId || null, ts },
      [DATA]: { profile: d.profile || null, resume: d.resume || null, ts },
    });
  });

  /* the ATS tab reported a blocker → relay it back so the Queue can flag it */
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[ATTN]) return;
        const v = changes[ATTN].newValue;
        if (!v) return;
        document.dispatchEvent(new CustomEvent('careerpilot:needs-attention', { detail: v }));
      });
    }
  } catch (e) { /* no storage events — needs-attention just won't round-trip */ }
})();
