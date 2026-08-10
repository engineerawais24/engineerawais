/* ============================================================
   CareerPilot Helper — Job Discovery v1 orchestrator (background worker).

   One click on "Fetch Jobs Now" in CareerPilot arrives here as a single
   `cp-fetch-jobs` message carrying the user's saved search URL for each
   portal. For every configured source this:

     1. opens the saved search in a BACKGROUND tab of the user's own Chrome —
        so it runs inside the session they are already logged into; nothing
        signs in, and no credential is ever read or stored
     2. injects harvest.js and asks it for the job cards on screen
     3. deduplicates by (source, source job id) AND by exact job URL
     4. saves each job through the EXISTING backend endpoint (POST /api/jobs),
        the same one "Save Current Job" has always used — no new endpoint
     5. closes the tab and reports four plain counts: found, saved,
        duplicate, failed

   Login wall or CAPTCHA → that source is reported `needs-attention` and
   NOTHING is harvested from it. It is never worked around.

   No matching, no scoring, no autofill, no application is touched here.
   Everything the run needs (tabs, harvest, HTTP, storage, clock) arrives in
   an injectable `ctx`, so the whole flow is testable without a browser tab.
   ============================================================ */

const CPFetchJobs = (() => {
  'use strict';

  const RESULT_KEY = 'cp_fetch_result';    // the last run, for the popup + the app relay
  const STATUS_KEY = 'cp_fetch_status';    // coarse progress while a run is in flight

  const DEFAULT_API = 'http://127.0.0.1:8000';

  /* the ONLY hosts a run may open — the three the extension holds host
     permissions for. A saved search URL that does not belong to its portal is
     simply not visited, so no other site can be opened through this path. */
  const PORTAL_HOSTS = {
    LinkedIn: /(^|\.)linkedin\.com$/i,
    Bayt: /(^|\.)bayt\.com$/i,
    GulfTalent: /(^|\.)gulftalent\.com$/i,
  };
  const PORTALS = Object.keys(PORTAL_HOSTS);

  const TAB_LOAD_TIMEOUT = 30000;          // give a slow portal page time to render
  const TAB_POLL = 500;
  const SETTLE_MS = 2500;                  // let the results list paint before reading
  /* the harvester itself waits for LinkedIn's virtualized list and scrolls it,
     so a single source can legitimately take a minute */
  const HARVEST_TIMEOUT = 120000;

  /* ---------- pure helpers (the testable core) ---------- */

  const trim = s => String(s == null ? '' : s).trim();

  function isHttpUrl(u) {
    const s = trim(u);
    if (!/^https?:\/\//i.test(s)) return false;
    try { return !!new URL(s).hostname; } catch (e) { return false; }
  }

  /* does this URL belong to the portal it was saved under? */
  function onPortal(id, url) {
    const re = PORTAL_HOSTS[id];
    if (!re || !isHttpUrl(url)) return false;
    try { return re.test(new URL(trim(url)).hostname); } catch (e) { return false; }
  }

  /* the sources this run will actually visit: a known portal with a usable
     saved-search URL ON THAT PORTAL. Anything else is simply not visited. */
  function validSources(list) {
    const out = [];
    (list || []).forEach(s => {
      const id = trim(s && s.id);
      const url = trim(s && s.url);
      if (PORTALS.indexOf(id) === -1 || !onPortal(id, url)) return;
      if (out.some(x => x.id === id)) return;          // one saved search per portal
      out.push({ id, url });
    });
    return out;
  }

  /* ---------- Bayt: one saved search is not enough ----------
     A broad "jobs in Saudi Arabia" search returns whatever Bayt puts on page
     one — around 30 postings, mostly irrelevant — so the roles actually wanted
     never appear. Instead a single Bayt run walks these search families, one
     page each. Results are pooled and de-duplicated across all of them by Bayt
     job id and exact URL, so a posting listed under two keywords is saved once.

     Nothing here decides what is KEPT — every harvested job still goes through
     the same backend filters (location, role, salary, nationality). This only
     decides what is LOOKED AT. */

  const BAYT_QUERIES = [
    'network security engineer',
    'cybersecurity',
    'technical consultant',
    'solutions engineer',
    'solutions architect',
    'presales engineer',
    'infrastructure engineer',
    'ICT',
    'technical project manager',
    'OT cybersecurity',
    'ICS security',
    'physical security',
    'PSIM',
  ];

  /* Bayt's country-scoped search pages: /en/<country>/jobs/<slug>-jobs/.
     (The country-less /en/jobs/... forms are disallowed by Bayt's robots.txt;
     these are not.) Kept as one template so it is a single edit if Bayt ever
     changes the shape. */
  const BAYT_SEARCH_TEMPLATE = 'https://www.bayt.com/en/saudi-arabia/jobs/{slug}-jobs/';

  const slugify = s => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  function baytSearchUrl(keyword) {
    return BAYT_SEARCH_TEMPLATE.replace('{slug}', slugify(keyword));
  }

  /* Turn each validated source into the tabs the run will actually open.
     Every portal keeps its own `portal` key, so host validation and the
     harvester still see 'Bayt' while the row is labelled by its keyword. */
  function expandSources(list, queries) {
    const qs = queries || BAYT_QUERIES;
    const out = [];
    (list || []).forEach(s => {
      if (s.id !== 'Bayt') { out.push({ id: s.id, portal: s.id, url: s.url }); return; }
      qs.forEach(q => out.push({ id: 'Bayt · ' + q, portal: 'Bayt', url: baytSearchUrl(q) }));
    });
    return out;
  }

  /* the two dedup keys the spec asks for */
  const urlKey = u => trim(u).toLowerCase().replace(/\/+$/, '');
  const idKey = j => (trim(j && j.source).toLowerCase() + '::' + trim(j && j.sourceJobId).toLowerCase());

  /* drop repeats WITHIN one run — the same posting listed twice on a page, or
     surfaced by two portals under the same URL. The backend rejects the rest. */
  function dedupe(jobs, seen) {
    const marks = seen || new Set();
    const unique = [];
    let duplicate = 0;
    (jobs || []).forEach(j => {
      if (!j || !trim(j.url) || !trim(j.title)) { return; }
      const k1 = idKey(j), k2 = urlKey(j.url);
      if ((trim(j.sourceJobId) && marks.has(k1)) || marks.has(k2)) { duplicate++; return; }
      if (trim(j.sourceJobId)) marks.add(k1);
      marks.add(k2);
      unique.push(j);
    });
    return { unique, duplicate, seen: marks };
  }

  /* exactly the payload "Save Current Job" already sends — no new job schema.
     Only what was VISIBLE on the results page is sent: no posted date (the cards
     show "3 days ago", not a date — inventing today's date would be a claim the
     portal never made), no salary, no description. */
  function payloadFor(job) {
    const url = trim(job.url);
    return {
      source: trim(job.source),
      source_job_id: trim(job.sourceJobId) || url,
      title: trim(job.title),
      company: trim(job.company),
      location: trim(job.location),
      apply_url: url,
      canonical_url: url.split(/[?#]/)[0],
      raw: { detectedBy: 'JobFetch/' + trim(job.source) },
    };
  }

  const BLOCK_REASON = {
    login: 'Sign-in required — open the saved search in Chrome and log in',
    captcha: 'CAPTCHA shown — open the saved search in Chrome and clear it',
    blocked: 'The portal blocked the page — open the saved search in Chrome',
  };

  /* `filtered` is a job the backend deliberately rejected (HTTP 422) — wrong
     country, off-target role, salary below the floor, nationality-restricted.
     That is the filters working, NOT a failure, so it is counted separately.
     `failed` is reserved for real transport or server errors. */
  function blankCounts() { return { found: 0, saved: 0, duplicate: 0, failed: 0, filtered: 0 }; }

  /* ---------- default context: the real browser + the real backend ---------- */

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function chromeSet(key, value) {
    return new Promise(resolve => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
          chrome.storage.local.set({ [key]: value }, () => { void (chrome.runtime && chrome.runtime.lastError); resolve({ ok: true }); });
        else resolve({ ok: false });
      } catch (e) { resolve({ ok: false }); }
    });
  }

  function tabsCreate(url) {
    return new Promise((resolve, reject) => {
      try { chrome.tabs.create({ url, active: false }, tab => (tab && tab.id != null) ? resolve(tab.id) : reject(new Error('could not open a tab'))); }
      catch (e) { reject(e); }
    });
  }
  function tabsGet(tabId) {
    return new Promise(resolve => {
      try { chrome.tabs.get(tabId, tab => { void (chrome.runtime && chrome.runtime.lastError); resolve(tab || null); }); }
      catch (e) { resolve(null); }
    });
  }
  function tabsRemove(tabId) {
    return new Promise(resolve => {
      try { chrome.tabs.remove(tabId, () => { void (chrome.runtime && chrome.runtime.lastError); resolve(true); }); }
      catch (e) { resolve(false); }
    });
  }

  /* open the saved search in a background tab and wait for it to finish
     loading. Polling chrome.tabs.get (rather than waiting on an event) also
     keeps the MV3 service worker alive across the whole run. */
  async function openTab(url) {
    const tabId = await tabsCreate(url);
    const started = Date.now();
    for (;;) {
      const tab = await tabsGet(tabId);
      if (!tab) throw new Error('the tab closed before it loaded');
      if (tab.status === 'complete') break;
      if (Date.now() - started > TAB_LOAD_TIMEOUT) break;      // read whatever rendered
      await sleep(TAB_POLL);
    }
    await sleep(SETTLE_MS);
    return tabId;
  }

  function harvestTab(tabId, source) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = fn => (v) => { if (!settled) { settled = true; fn(v); } };
      const ok = done(resolve), fail = done(reject);
      /* the LinkedIn harvest scrolls, so it answers late — but never never */
      setTimeout(() => fail(new Error('the page did not finish reading in time')), HARVEST_TIMEOUT);
      try {
        chrome.scripting.executeScript({ target: { tabId }, files: ['harvest.js'] }, () => {
          const err = chrome.runtime && chrome.runtime.lastError;
          if (err) { fail(new Error(err.message || 'could not read the page')); return; }
          chrome.tabs.sendMessage(tabId, { type: 'cp-harvest', source }, res => {
            const e2 = chrome.runtime && chrome.runtime.lastError;
            if (e2 || !res) { fail(new Error((e2 && e2.message) || 'the page did not answer')); return; }
            ok(res);
          });
        });
      } catch (e) { fail(e); }
    });
  }

  async function postJob(api, body) {
    const res = await fetch((api || DEFAULT_API) + '/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status };
  }

  function defaultCtx(api) {
    return {
      openTab,
      harvest: harvestTab,
      closeTab: tabsRemove,
      post: body => postJob(api, body),
      set: chromeSet,
      now: () => Date.now(),
    };
  }

  /* ---------- one source ---------- */

  async function runSource(src, ctx, seen) {
    const row = Object.assign({ id: src.id, url: src.url, status: 'ok', reason: null, diag: null }, blankCounts());
    let tabId = null;
    /* the PORTAL the page belongs to — 'Bayt' for every one of its keyword
       searches, whose row ids are 'Bayt · <keyword>' */
    const portal = src.portal || src.id;
    try {
      tabId = await ctx.openTab(src.url);
      const res = await ctx.harvest(tabId, portal);
      /* how the read actually went: scroll rounds · card candidates · unique
         ids · parsed · failed cards. Kept even when the harvest failed — that
         is precisely when it is worth reading. */
      if (res && res.diag) row.diag = res.diag;

      if (res && res.blocked) {
        row.status = 'needs-attention';
        row.reason = BLOCK_REASON[res.blocked] || 'This source needs attention';
        return row;
      }
      if (!res || res.ok === false) {
        row.status = 'failed';
        row.reason = (res && res.error) || 'could not read that saved search';
        return row;
      }

      const harvested = (res.jobs || []).map(j => Object.assign({}, j, { source: j.source || portal }));
      row.found = harvested.length;

      const d = dedupe(harvested, seen);
      row.duplicate += d.duplicate;

      for (const job of d.unique) {
        try {
          const r = await ctx.post(payloadFor(job));
          if (r && r.status === 201) row.saved++;
          else if (r && r.status === 409) row.duplicate++;
          /* 422 = the backend filters rejected it on purpose (wrong country,
             off-target role, salary below the floor, nationality-restricted).
             That is the filters working, not a failure. */
          else if (r && r.status === 422) row.filtered++;
          else row.failed++;
        } catch (e) {
          row.failed++;                     // no response at all: a real failure
        }
      }
      if (row.failed && !row.saved) {
        row.status = 'failed';
        row.reason = 'CareerPilot could not save these jobs — is the backend running?';
      } else if (row.filtered && !row.saved && !row.duplicate) {
        row.reason = row.filtered + ' job' + (row.filtered === 1 ? '' : 's')
          + ' filtered out — none matched your location, role and salary rules';
      }
      return row;
    } catch (e) {
      row.status = 'failed';
      row.reason = (e && e.message) || 'could not open that saved search';
      return row;
    } finally {
      if (tabId != null) { try { await ctx.closeTab(tabId); } catch (e) { /* the tab may already be gone */ } }
    }
  }

  /* ---------- the run ---------- */

  async function run(msg, injected) {
    const ctx = injected || defaultCtx(trim(msg && msg.api) || DEFAULT_API);
    const now = (ctx.now || Date.now)();
    const token = trim(msg && msg.token) || 'fetch-' + now.toString(36);

    const configured = validSources(msg && msg.sources);
    if (!configured.length) {
      const empty = { ok: false, token, error: 'no saved search URL is set', totals: blankCounts(), sources: [], ts: now };
      await ctx.set(RESULT_KEY, empty);
      return empty;
    }
    /* one Bayt saved search becomes one tab per keyword family */
    const sources = expandSources(configured, msg && msg.baytQueries);

    await ctx.set(STATUS_KEY, { running: true, token, sources: sources.map(s => s.id), ts: now });

    /* ONE `seen` set for the whole run, so a posting that shows up under
       several Bayt keywords is saved once */
    const seen = new Set();
    const rows = [];
    for (const src of sources) rows.push(await runSource(src, ctx, seen));

    const totals = blankCounts();
    rows.forEach(r => {
      totals.found += r.found; totals.saved += r.saved;
      totals.duplicate += r.duplicate; totals.failed += r.failed;
      totals.filtered += r.filtered || 0;
    });

    const result = {
      ok: true, token, totals, sources: rows,
      attention: rows.filter(r => r.status === 'needs-attention').map(r => r.id),
      ts: (ctx.now || Date.now)(),
    };
    await ctx.set(STATUS_KEY, { running: false, token, ts: result.ts });
    await ctx.set(RESULT_KEY, result);
    return result;
  }

  const api = {
    run, runSource, validSources, expandSources, baytSearchUrl, slugify,
    dedupe, payloadFor, isHttpUrl, onPortal, urlKey, idKey,
    blankCounts, PORTALS, PORTAL_HOSTS, BAYT_QUERIES, BAYT_SEARCH_TEMPLATE,
    RESULT_KEY, STATUS_KEY, DEFAULT_API, BLOCK_REASON,
  };
  if (typeof self !== 'undefined') self.CPFetchJobs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
