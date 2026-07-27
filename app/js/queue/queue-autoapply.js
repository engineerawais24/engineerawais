/* ============================================================
   QueueAutoApply — the app side of Queue → ATS Auto Autofill v1.

   When the Application Queue opens a job, this tells the Chrome extension
   (via a DOM event the extension's bridge content script listens for) that
   the tab was opened from the Queue, and hands over the autofill payload:
   the flat profile the extension's Autofill v2 expects (built from the app's
   own profile) plus the master résumé.

   It also listens for the extension's `careerpilot:needs-attention` event
   (relayed from an ATS tab that hit a login/CAPTCHA/blocked/no-form page) and
   flags that job in the Queue.

   No backend, no UI. If the extension isn't installed nothing happens — the
   job tab just opens and the manual Autofill button still works.
   ============================================================ */

const QueueAutoApply = (() => {

  let _bound = false;

  /* ---------- profile shaping ----------
     The app stores the profile nested (personal/contact/authorization…); the
     extension's Autofill v2 wants a FLAT object. This mirrors the mapping the
     popup does from the backend profile, but from the app's local shape. */
  function yearsFromHistory(p) {
    try {
      const starts = [];
      if (p.employment && p.employment.startDate) starts.push(p.employment.startDate);
      (p.history || []).forEach(h => { if (h.startDate) starts.push(h.startDate); });
      starts.sort();
      if (starts.length && /^\d{4}/.test(starts[0])) {
        const first = new Date(starts[0].slice(0, 7) + '-01T00:00:00');
        if (!isNaN(first)) return String(Math.max(0, Math.round((Date.now() - first) / (365.25 * 24 * 3600 * 1000))));
      }
    } catch (e) { /* leave blank */ }
    return '';
  }

  function buildAutofillProfile(p) {
    if (!p) return null;
    const per = p.personal || {}, con = p.contact || {}, links = p.links || {};
    const emp = p.employment || {}, auth = p.authorization || {}, pref = p.preferences || {};
    const first = per.firstName || '', last = per.lastName || '';
    const status = String(auth.status || '');
    const authorizedIn = String(auth.authorizedIn || '');
    const nationality = auth.nationality
      ? String(auth.nationality).trim()
      : (status.toLowerCase() === 'citizen' && authorizedIn ? authorizedIn.split(',')[0].trim() : '');
    const workAuthorization = [status, authorizedIn ? ('authorized in ' + authorizedIn) : ''].filter(Boolean).join(' — ');

    return {
      firstName: first, lastName: last, fullName: (first + ' ' + last).trim(),
      email: con.email || '', phone: con.phone || '', city: con.city || '', country: con.country || '',
      currentTitle: emp.title || per.headline || '', currentCompany: emp.company || '',
      headline: per.headline || '', summary: per.summary || '',
      yearsExperience: (auth.yearsExperience != null && auth.yearsExperience !== '')
        ? String(auth.yearsExperience) : yearsFromHistory(p),
      noticePeriod: emp.noticePeriod || '',
      nationality,
      gender: auth.gender ? String(auth.gender).trim() : '',
      maritalStatus: auth.maritalStatus ? String(auth.maritalStatus).trim() : '',
      workAuthorization,
      needsSponsorship: typeof auth.sponsorship === 'boolean' ? auth.sponsorship : null,
      willRelocate: typeof pref.relocation === 'boolean' ? pref.relocation : null,
      linkedin: links.linkedin || '',
    };
  }

  /* the payload the extension autofills TEXT from. It carries the profile only —
     NOT a résumé binary: the résumé is the extension's own default
     (chrome.storage.local `cp_default_resume`, set via the popup), which is the
     single source of truth. Baking a résumé copy into the queue intent made a
     replaced résumé go stale (an old DOCX kept being attached). */
  function payload() {
    let profile = null;
    try { if (typeof ProfileStore !== 'undefined') profile = buildAutofillProfile(ProfileStore.load()); } catch (e) { /* optional */ }
    return { profile };
  }

  function dispatch(name, detail) {
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent(name, { detail }));
      }
    } catch (e) { /* no DOM */ }
  }

  /* window.postMessage is how we reach the extension's content-script bridge:
     it is structured-cloned and crosses from this page's world into the bridge's
     isolated world (a CustomEvent's `detail` does NOT cross — that was the bug). */
  function postToExtension(msg) {
    try {
      if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
        window.postMessage(msg, (window.location && window.location.origin) || '*');
      }
    } catch (e) { /* no window */ }
  }

  /* called by the Queue when it opens a job in a new tab (e.g. "Open Next") */
  function signalOpen(o) {
    const url = o && o.url;
    const jobId = o && o.jobId;
    if (!url) return null;
    const token = 'cpq-' + (jobId || 'job') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const pay = payload();
    /* the reliable path the bridge listens on — job info + profile, NO résumé */
    postToExtension({ __careerpilot: true, kind: 'queue-open', url, token, jobId, profile: pay.profile });
    /* same-world CustomEvent kept for any in-page listener / back-compat */
    dispatch('careerpilot:queue-open', { url, token, jobId, profile: pay.profile });
    return token;
  }

  /* flag the right queued job when the extension reports a blocker on its tab */
  function onAttention(d) {
    if (!d || typeof ApplicationQueue === 'undefined' || !ApplicationQueue.markAttentionFor) return;
    const r = ApplicationQueue.markAttentionFor(d.jobId, { reason: d.reason });
    if (r && r.ok) {
      if (typeof toast === 'function') toast('A queued job needs your attention — ' + (d.reason || 'open it manually'), 'info');
      if (typeof currentRoute === 'function' && currentRoute() === 'approvals' && typeof navigate === 'function') navigate();
    }
  }

  /* listen for the extension relaying a "needs attention" from an ATS tab —
     via postMessage (the bridge's channel) and the legacy CustomEvent */
  function bind() {
    if (_bound || typeof document === 'undefined') return;
    _bound = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('message', function (ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.__careerpilot_from_ext !== true || d.kind !== 'needs-attention') return;
        onAttention(d.detail || {});
      });
    }
    document.addEventListener('careerpilot:needs-attention', function (ev) { onAttention((ev && ev.detail) || {}); });
  }

  return { buildAutofillProfile, payload, signalOpen, bind };
})();
