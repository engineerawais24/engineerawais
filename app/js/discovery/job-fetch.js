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

  /* ---------- public ATS feeds (Greenhouse + Lever) ----------
     These are the vendors' own public JSON board APIs, so they need no browser
     session and no extension: the BACKEND fetches them (POST /api/ats/import),
     filters to Saudi Arabia / UAE / GCC / Remote, dedups by ATS job id and exact
     URL, and hands back the rows it stored. Runs on every Fetch Jobs Now,
     alongside — and independently of — the portal saved searches. */

  const ATS_TIMEOUT = 120000;      // real boards, several companies, one request
  let _atsPending = null;          // Promise<fragment|null> for the run in flight

  const num = v => Number(v || 0) || 0;

  /* the backend summary, reshaped into the same rows the panel already renders */
  function atsFragment(d) {
    const rows = (d.detail || []).map(x => {
      const filtered = num(x.filtered);
      const reason = x.error
        ? String(x.error)
        : (filtered ? filtered + ' posting' + (filtered === 1 ? '' : 's') + ' outside Saudi Arabia / UAE / GCC / Remote' : '');
      return {
        id: String(x.company || 'ATS') + ' · ' + String(x.ats || 'ats'),
        found: num(x.found), saved: num(x.saved), duplicate: num(x.duplicate), failed: num(x.failed),
        status: x.error ? 'failed' : 'ok', reason, diag: null,
      };
    });
    return {
      totals: { found: num(d.found), saved: num(d.saved), duplicate: num(d.duplicate), failed: num(d.failed) },
      sources: rows,
      jobs: Array.isArray(d.jobs) ? d.jobs : [],
    };
  }

  function atsUnavailable(message) {
    return {
      totals: { found: 0, saved: 0, duplicate: 0, failed: 0 },
      sources: [{
        id: 'Greenhouse + Lever', found: 0, saved: 0, duplicate: 0, failed: 0,
        status: 'failed', reason: message, diag: null,
      }],
      jobs: [],
    };
  }

  async function runAtsImport() {
    const c = (typeof APIClient !== 'undefined') ? APIClient : null;
    if (!c) return null;
    try {
      const r = await c.request('POST', apiBase() + '/api/ats/import', { retries: 0, timeout: ATS_TIMEOUT });
      const d = r && r.data;
      if (!d || typeof d !== 'object') return atsUnavailable('the ATS import returned nothing');
      return atsFragment(d);
    } catch (e) {
      /* the backend is where these feeds are fetched, so no backend = no ATS */
      return atsUnavailable('CareerPilot\'s backend is not reachable — start it to import Greenhouse and Lever');
    }
  }

  /* ---------- Cisco (careers.cisco.com) ----------
     Cisco's own job search, fetched backend-side like the ATS feeds and put
     through the same location / role / salary rules. One row per country. */

  function ciscoFragment(d) {
    const rows = (d.detail || []).map(x => {
      const filtered = num(x.filtered);
      const reason = x.error
        ? String(x.error)
        : (filtered ? filtered + ' posting' + (filtered === 1 ? '' : 's') + ' outside the target roles or below the salary floor' : '');
      return {
        id: 'Cisco · ' + String(x.country || ''),
        found: num(x.found), saved: num(x.saved), duplicate: num(x.duplicate), failed: num(x.failed),
        status: x.error ? 'failed' : 'ok', reason, diag: null,
      };
    });
    return {
      totals: { found: num(d.found), saved: num(d.saved), duplicate: num(d.duplicate), failed: num(d.failed) },
      sources: rows,
      jobs: Array.isArray(d.jobs) ? d.jobs : [],
    };
  }

  function ciscoUnavailable(message) {
    return {
      totals: { found: 0, saved: 0, duplicate: 0, failed: 0 },
      sources: [{ id: 'Cisco', found: 0, saved: 0, duplicate: 0, failed: 0, status: 'failed', reason: message, diag: null }],
      jobs: [],
    };
  }

  async function runCiscoImport() {
    const c = (typeof APIClient !== 'undefined') ? APIClient : null;
    if (!c) return null;
    try {
      const r = await c.request('POST', apiBase() + '/api/cisco/import', { retries: 0, timeout: ATS_TIMEOUT });
      const d = r && r.data;
      if (!d || typeof d !== 'object') return ciscoUnavailable('the Cisco import returned nothing');
      return ciscoFragment(d);
    } catch (e) {
      return ciscoUnavailable('CareerPilot\'s backend is not reachable — start it to import Cisco jobs');
    }
  }

  /* both backend-side sources, run together */
  async function runBackendSources() {
    const parts = await Promise.all([runAtsImport(), runCiscoImport()]);
    const live = parts.filter(Boolean);
    if (!live.length) return null;
    return live.reduce((acc, p) => ({
      totals: {
        found: acc.totals.found + p.totals.found,
        saved: acc.totals.saved + p.totals.saved,
        duplicate: acc.totals.duplicate + p.totals.duplicate,
        failed: acc.totals.failed + p.totals.failed,
      },
      sources: acc.sources.concat(p.sources),
      jobs: acc.jobs.concat(p.jobs),
    }), { totals: { found: 0, saved: 0, duplicate: 0, failed: 0 }, sources: [], jobs: [] });
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

    const token = 'cpf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    ui.running = true; ui.token = token; ui.startedAt = Date.now(); ui.error = null;

    /* the backend-side sources always run — the public Greenhouse + Lever feeds
       and Cisco's own job search. They need no saved search and no browser
       session, so they work even with no portals configured. */
    _atsPending = runBackendSources();

    /* the portal saved searches (Bayt / GulfTalent) still go through the
       extension; LinkedIn is imported from its own tab, see linkedin-import.js */
    const sent = sources.length && postToExtension({
      __careerpilot: true, kind: 'fetch-jobs', token, sources, api: apiBase(),
    });

    if (!sent) {
      /* nothing for the extension to do (or it isn't there) — the ATS import is
         the whole run, so finish as soon as it lands */
      _atsPending.then(() => finish(token, sources.length ? null : { ok: true, token, totals: null, sources: [], jobs: [] }));
      say(sources.length
        ? 'Importing Greenhouse and Lever — the extension did not answer for your saved searches…'
        : 'Importing jobs from Greenhouse and Lever…', 'info');
      refresh();
      return { ok: true, token, ats: true, sources: [] };
    }

    clearTimer();
    if (typeof setTimeout === 'function') {
      _timer = setTimeout(() => {
        if (ui.running && ui.token === token) finish(token, null, 'timeout');
      }, REPLY_TIMEOUT);
    }

    say('Fetching jobs — Greenhouse and Lever, plus your saved searches…', 'info');
    refresh();
    return { ok: true, token, ats: true, sources: sources.map(s => s.id) };
  }

  const NO_EXTENSION = 'The CareerPilot Chrome extension did not answer — load it in Chrome, then try again';
  const TIMED_OUT = 'The fetch did not finish in time — check the tabs Chrome opened, then try again';

  /* One run, two independent halves: the portal saved searches (extension) and
     the public ATS feeds (backend). Their counts add up, their source rows sit
     side by side, and their saved jobs all reach the board. A run where the
     extension failed but Greenhouse worked is still a successful run. */
  function mergeAts(base, ats) {
    const t = (base && base.totals) || { found: 0, saved: 0, duplicate: 0, failed: 0 };
    return {
      ok: (base && base.ok !== false) || !!(ats.sources || []).length,
      token: base && base.token,
      /* the extension's own error is dropped once ATS carried the run */
      error: (base && base.ok === false && !(ats.totals.found || ats.totals.saved)) ? base.error : '',
      totals: {
        found: num(t.found) + ats.totals.found,
        saved: num(t.saved) + ats.totals.saved,
        duplicate: num(t.duplicate) + ats.totals.duplicate,
        failed: num(t.failed) + ats.totals.failed,
      },
      sources: ((base && base.sources) || []).concat(ats.sources),
      attention: (base && base.attention) || [],
      jobs: (((base && base.jobs) || []).concat(ats.jobs)),
    };
  }

  /* record the outcome of a run, whatever it was. Resolves once the newly saved
     jobs have been pulled into Today's Jobs, so a caller can await the board
     being up to date. */
  async function finish(token, detail, why) {
    clearTimer();
    ui.running = false;
    ui.token = null;

    let result = (detail && typeof detail === 'object')
      ? detail
      : { ok: false, error: why === 'timeout' ? TIMED_OUT : NO_EXTENSION, totals: null, sources: [] };

    /* fold in the public ATS feeds, whatever the portal side did. They are an
       independent source: Greenhouse and Lever still count even when the
       extension never answered. */
    const ats = _atsPending ? await _atsPending.catch(() => null) : null;
    _atsPending = null;
    if (ats) result = mergeAts(result, ats);

    const run = JobFetchStore.saveRun(result);
    ui.error = (run && run.ok) ? null : (run && run.error) || null;

    if (run && run.ok) {
      const t = run.totals;
      /* Put the saved jobs on the board straight from what the run handed back
         (the ATS import returns the rows it stored, backend id included). This
         needs no second request, so the jobs show up even if the page cannot
         GET from the backend. The pull below is a top-up for anything saved
         outside this run. */
      upsertRunJobs(result);
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

  /* Fold every job the run saved into the SAME store Today's Jobs renders
     (`ImportedJobs`, which the Imports panel inside the board reads). Deduped
     by the backend job's own identity and by exact URL, so re-running never
     doubles a card. */
  function upsertRunJobs(detail) {
    if (typeof ImportedJobs === 'undefined' || !detail || !Array.isArray(detail.jobs)) return 0;
    let added = 0;
    detail.jobs.forEach(j => {
      try {
        const r = ImportedJobs.upsertFromBackend(j);
        if (r && r.ok && !r.duplicate) added++;
      } catch (e) { /* one bad row must not lose the rest */ }
    });
    return added;
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

  return {
    ui, render, bind, fetchNow, onResult, finish, setDraft, saveSearch, REPLY_TIMEOUT,
    /* public ATS feeds (Greenhouse + Lever) */
    runAtsImport, atsFragment, mergeAts, upsertRunJobs, ATS_TIMEOUT,
    /* Cisco (careers.cisco.com) */
    runCiscoImport, ciscoFragment, runBackendSources,
  };
})();
