/* ============================================================
   JobFetch — "Fetch Jobs Now" (Job Discovery v1), app side.

   One button. It asks the CareerPilot Chrome extension to open each saved
   search in the user's OWN logged-in Chrome, read the job cards on screen,
   and save them through the existing backend (POST /api/jobs). When the run
   comes back, the newly saved jobs are pulled straight into Today's Jobs via
   the existing JobsBackendSync, so they appear immediately.

   What this module does NOT do, deliberately (v1 scope):
     • no matching, no scoring, no ranking — the board already does that
     • no autofill, no application, no submission of any kind
     • no scraping from the app itself: the app has no session, the browser
       does. Nothing here fetches a portal page.

   Without the extension installed the button reports that honestly and
   changes nothing. Communication reuses the SAME window.postMessage bridge
   the Application Queue already uses (a CustomEvent's `detail` does not cross
   into the content script's world — that was the original bug).
   ============================================================ */

const JobFetch = (() => {

  /* three tabs, each allowed a slow load — and LinkedIn's virtualized list is
     scrolled in rounds, so that one source alone can take a minute */
  const REPLY_TIMEOUT = 360000;      // 6 min

  const ui = {
    running: false,
    token: null,
    startedAt: null,
    error: null,
    drafts: {},                      // portalId -> URL being typed (not yet saved)
  };

  let _bound = false;
  let _timer = null;

  /* ---------- plumbing ---------- */

  function refresh() {
    if (typeof currentRoute === 'function' && currentRoute() === 'jobs' && typeof navigate === 'function') navigate();
  }

  function say(msg, kind) { if (typeof toast === 'function') toast(msg, kind); }

  /* The bridge content script listens on THIS window, so the message never
     leaves the page. Target the app's own origin when it has a real one; a
     page opened straight off disk (file://) has an opaque origin that no
     targetOrigin string can ever match, and the message would be dropped
     silently — there, '*' is the only value that is delivered at all. */
  function postToExtension(msg) {
    try {
      if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
        const origin = (window.location && window.location.origin) || '';
        window.postMessage(msg, /^https?:/i.test(origin) ? origin : '*');
        return true;
      }
    } catch (e) { /* no window */ }
    return false;
  }

  function apiBase() {
    try { return (typeof Backend !== 'undefined') ? Backend.baseUrl() : ''; } catch (e) { return ''; }
  }

  function clearTimer() {
    if (_timer != null && typeof clearTimeout === 'function') clearTimeout(_timer);
    _timer = null;
  }

  /* ---------- saved search URLs ---------- */

  function setDraft(portalId, value) { ui.drafts[portalId] = String(value == null ? '' : value); }

  /* save whatever is in that portal's input (or an explicit value) */
  function saveSearch(portalId, value) {
    const raw = (value !== undefined) ? value : ui.drafts[portalId];
    const fromDom = (raw === undefined && typeof document !== 'undefined')
      ? (document.getElementById('jf-url-' + portalId) || {}).value : undefined;
    const r = JobFetchStore.setSearch(portalId, raw !== undefined ? raw : (fromDom || ''));
    if (!r.ok) { ui.error = r.error; say(r.error, 'error'); refresh(); return r; }
    ui.error = null;
    delete ui.drafts[portalId];
    say(r.url ? `Saved search set for ${portalId}` : `Saved search cleared for ${portalId}`);
    refresh();
    return r;
  }

  /* ---------- the run ---------- */

  function fetchNow() {
    if (ui.running) return { ok: false, error: 'A fetch is already running' };

    const sources = JobFetchStore.configured();
    if (!sources.length) {
      ui.error = 'Add at least one saved search URL first';
      say(ui.error, 'error');
      refresh();
      return { ok: false, error: ui.error };
    }

    const token = 'cpf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    ui.running = true; ui.token = token; ui.startedAt = Date.now(); ui.error = null;

    const sent = postToExtension({
      __careerpilot: true, kind: 'fetch-jobs', token, sources, api: apiBase(),
    });
    if (!sent) { finish(token, null); return { ok: false, error: ui.error }; }

    clearTimer();
    if (typeof setTimeout === 'function') {
      _timer = setTimeout(() => {
        if (ui.running && ui.token === token) finish(token, null, 'timeout');
      }, REPLY_TIMEOUT);
    }

    say('Fetching jobs — opening your saved searches…', 'info');
    refresh();
    return { ok: true, token, sources: sources.map(s => s.id) };
  }

  const NO_EXTENSION = 'The CareerPilot Chrome extension did not answer — load it in Chrome, then try again';
  const TIMED_OUT = 'The fetch did not finish in time — check the tabs Chrome opened, then try again';

  /* record the outcome of a run, whatever it was. Resolves once the newly saved
     jobs have been pulled into Today's Jobs, so a caller can await the board
     being up to date. */
  async function finish(token, detail, why) {
    clearTimer();
    ui.running = false;
    ui.token = null;

    const result = (detail && typeof detail === 'object')
      ? detail
      : { ok: false, error: why === 'timeout' ? TIMED_OUT : NO_EXTENSION, totals: null, sources: [] };

    const run = JobFetchStore.saveRun(result);
    ui.error = (run && run.ok) ? null : (run && run.error) || null;

    if (run && run.ok) {
      const t = run.totals;
      /* the newly saved jobs live in the backend — pull them into Today's Jobs
         right away so the board shows them without a refresh */
      await pullIntoBoard();
      say(`Found ${t.found} · saved ${t.saved} · duplicate ${t.duplicate} · failed ${t.failed}`,
        t.failed ? 'error' : 'success');
      const attn = (run.sources || []).filter(s => s.status === 'needs-attention').map(s => s.id);
      if (attn.length) say(`${attn.join(', ')} needs attention — sign in, then fetch again`, 'error');
    } else {
      say(ui.error || 'The fetch did not run', 'error');
    }
    refresh();
    return run;
  }

  async function pullIntoBoard() {
    if (typeof JobsBackendSync === 'undefined') return null;
    try { return await JobsBackendSync.pull({ force: true }); }
    catch (e) { return null; }            // the board keeps whatever it had
  }

  /* the extension's reply (direct ACK, or the bridge's storage relay) */
  function onResult(token, detail) {
    if (!ui.running) return null;                       // nothing in flight
    if (token && ui.token && token !== ui.token) return null;   // a stale run
    return finish(ui.token || token, detail);
  }

  function bind() {
    if (_bound || typeof window === 'undefined') return;
    _bound = true;
    window.addEventListener('message', function (ev) {
      if (ev.source !== window) return;
      const d = ev.data;
      if (!d || d.__careerpilot_from_ext !== true || d.kind !== 'fetch-result') return;
      onResult(d.token || null, d.detail || null);
    });
  }

  /* ---------- rendering ---------- */

  function render() {
    return (typeof JobFetchView !== 'undefined') ? JobFetchView.panel(ui) : '';
  }

  return { ui, render, bind, fetchNow, onResult, finish, setDraft, saveSearch, REPLY_TIMEOUT };
})();
