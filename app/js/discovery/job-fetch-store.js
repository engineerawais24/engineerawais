/* ============================================================
   JobFetchStore — Job Discovery v1 settings + last run.

   Holds exactly two things, in the existing platform storage layer:

     • ONE saved search URL per portal — LinkedIn Jobs, Bayt, GulfTalent.
       The URL is the user's own search, copied from their browser's address
       bar. It is validated as a string (right portal, http/https) and stored;
       the page behind it is never requested from here.

     • the LAST run's plain counts — found / saved / duplicate / failed, plus
       a per-source status so a portal that needs signing in can say so.

   No credentials, no cookies, no tokens: the fetch runs in the user's own
   logged-in Chrome via the extension, so there is nothing secret to keep.
   ============================================================ */

const JobFetchStore = (() => {

  const STORAGE_KEY = 'job_fetch_v1';

  const PORTALS = [
    { id: 'LinkedIn',   label: 'LinkedIn Jobs', host: /(^|\.)linkedin\.com$/,   example: 'https://www.linkedin.com/jobs/search/?keywords=solutions%20engineer' },
    { id: 'Bayt',       label: 'Bayt',          host: /(^|\.)bayt\.com$/,       example: 'https://www.bayt.com/en/uae/jobs/solutions-engineer-jobs/' },
    { id: 'GulfTalent', label: 'GulfTalent',    host: /(^|\.)gulftalent\.com$/, example: 'https://www.gulftalent.com/uae/jobs/title/solutions-engineer' },
  ];

  const trim = s => String(s == null ? '' : s).trim();
  const portal = id => PORTALS.find(p => p.id === id) || null;

  function blank() {
    const searches = {};
    PORTALS.forEach(p => { searches[p.id] = ''; });
    return { searches, lastRun: null };
  }

  function load() {
    const raw = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    const state = blank();
    if (raw && typeof raw === 'object') {
      const s = raw.searches || {};
      PORTALS.forEach(p => { state.searches[p.id] = trim(s[p.id]); });
      state.lastRun = raw.lastRun || null;
    }
    return state;
  }

  function persist(state) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, state);
    return state;
  }

  /* ---------- the saved search URL ---------- */

  /* a URL is only accepted for the portal it actually belongs to — pasting a
     Bayt search into the LinkedIn slot would open the wrong page and harvest
     nothing, so it is rejected with a plain message instead */
  function validate(portalId, url) {
    const p = portal(portalId);
    if (!p) return { ok: false, error: 'Unknown portal' };
    const u = trim(url);
    if (!u) return { ok: true, url: '' };                 // clearing it is allowed
    let parsed;
    try { parsed = new URL(u); } catch (e) { return { ok: false, error: 'Enter a full URL, starting with https://' }; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Enter a full URL, starting with https://' };
    }
    if (!p.host.test(parsed.hostname.toLowerCase())) {
      return { ok: false, error: `That is not a ${p.label} URL — paste the search from ${p.label}` };
    }
    return { ok: true, url: u };
  }

  function setSearch(portalId, url) {
    const v = validate(portalId, url);
    if (!v.ok) return v;
    const state = load();
    state.searches[portalId] = v.url;
    persist(state);
    return { ok: true, url: v.url };
  }

  function searchFor(portalId) { return load().searches[portalId] || ''; }

  /* the sources a run would actually visit — portals with a saved search */
  function configured() {
    const state = load();
    return PORTALS.filter(p => !!state.searches[p.id]).map(p => ({ id: p.id, url: state.searches[p.id] }));
  }

  /* every portal, with its current URL — what the panel renders */
  function sources() {
    const state = load();
    return PORTALS.map(p => ({
      id: p.id, label: p.label, example: p.example,
      url: state.searches[p.id] || '', configured: !!state.searches[p.id],
    }));
  }

  /* ---------- the last run ---------- */

  /* `filtered` = deliberately rejected by the job filters (the backend answers
     HTTP 422). It is NOT a failure, so it is counted and shown separately. */
  const COUNTS = ['found', 'saved', 'duplicate', 'failed', 'filtered'];
  /* how the read itself went — kept per source so a harvest that silently
     under-collects (LinkedIn's virtualized list) is diagnosable, not a mystery */
  const DIAG = ['scrollRounds', 'cardCandidates', 'uniqueIds', 'parsed', 'failedCards'];

  function normalizeDiag(d) {
    if (!d) return null;
    const out = {};
    DIAG.forEach(k => { out[k] = Number(d[k] || 0) || 0; });
    return out;
  }

  /* keep ONLY the four counts, a per-source status and that source's read
     diagnostics — nothing else is shown, so nothing else is stored */
  function normalizeRun(res, at) {
    if (!res) return null;
    const totals = {};
    COUNTS.forEach(k => { totals[k] = Number((res.totals && res.totals[k]) || 0) || 0; });
    const rows = (res.sources || []).map(r => {
      const row = { id: trim(r.id), status: trim(r.status) || 'ok', reason: trim(r.reason) || '', diag: normalizeDiag(r.diag) };
      COUNTS.forEach(k => { row[k] = Number(r[k] || 0) || 0; });
      return row;
    });
    return {
      at: at || Date.now(),
      ok: res.ok !== false,
      error: trim(res.error) || '',
      totals,
      sources: rows,
    };
  }

  function saveRun(res, at) {
    const state = load();
    state.lastRun = normalizeRun(res, at);
    persist(state);
    return state.lastRun;
  }

  function lastRun() { return load().lastRun; }

  function clear() { persist(blank()); }

  return {
    STORAGE_KEY, PORTALS, COUNTS, DIAG,
    load, blank, validate, setSearch, searchFor, configured, sources,
    normalizeRun, normalizeDiag, saveRun, lastRun, clear,
  };
})();
