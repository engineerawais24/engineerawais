/* ============================================================
   CareerPilot Helper — Job Discovery v1 harvester (content script).

   Reads the job cards rendered on a saved-search results page in the user's own
   logged-in Chrome tab, for the three portals CareerPilot fetches from:
   LinkedIn Jobs, Bayt and GulfTalent.

   It is a READER, nothing else:
     • no network calls, no page mutation, no clicks, no login
     • it uses the session the user is already signed into — it never
       authenticates, and it never sees or stores a credential
     • per job it returns exactly the five visible fields CareerPilot stores
       plus the portal's own job id:
         { title, company, location, url, source, sourceJobId }
     • a login wall or a CAPTCHA is REPORTED, never worked around — the
       source comes back `blocked` and CareerPilot marks it Needs Attention

   LINKEDIN IS DIFFERENT, and v1 got it wrong: LinkedIn VIRTUALIZES the left
   results list. Only the handful of cards near the viewport exist in the DOM at
   any moment — the rest are empty <li> placeholders, and cards scrolled past are
   destroyed again. A single read of a freshly opened background tab therefore
   saw one job (usually just the one the URL had selected), while the page said
   "99+ results". So the LinkedIn path now:

     • scopes itself to the LEFT RESULTS LIST and never reads the job-details
       panel on the right (which carries its own /jobs/view/ links)
     • SCROLLS the results container in rounds, collecting newly rendered cards
       by LinkedIn job id after each round
     • stops on 3 consecutive rounds with no new id, or 50 unique jobs
     • reports diagnostics (scroll rounds · card candidates · unique ids ·
       parsed · failed) and calls a harvest a FAILURE — not a success — when
       several cards are on screen but almost nothing parsed

   Bayt and GulfTalent are untouched: they render their whole results page at
   once, so they still take the original single read.

   Injected on demand by the background worker (chrome.scripting.executeScript)
   and asked for one harvest via a `cp-harvest` runtime message.
   ============================================================ */

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.__cpHarvestLoaded) return;
  if (typeof window !== 'undefined') window.__cpHarvestLoaded = true;

  /* ---------- small helpers (same rules the job detector already uses) ---------- */

  const txt = el => (el && (el.textContent || '').replace(/\s+/g, ' ').trim()) || '';
  const firstLine = s => (s || '').split('\n').map(x => x.trim()).find(Boolean) || '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* LinkedIn doubles link text into a visually-hidden span, so "Senior
     Engineer" arrives as "Senior EngineerSenior Engineer" — halve it. */
  function undouble(s) {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    if (!t) return t;
    const half = t.length / 2;
    if (t.length % 2 === 0 && t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
    const m = t.match(/^(.+?)\s*\1$/);
    return m ? m[1].trim() : t;
  }

  /* absolute, query/hash-free URL for a card's href */
  function absUrl(href, origin) {
    const raw = String(href || '').trim();
    if (!raw) return '';
    const clean = raw.split(/[?#]/)[0];
    if (/^https?:\/\//i.test(clean)) return clean;
    if (clean.charAt(0) === '/') return String(origin || '').replace(/\/+$/, '') + clean;
    return '';
  }

  const rendered = el => !el || !el.getClientRects || !!el.getClientRects().length;

  /* ---------- the three portals ---------- */

  const PORTALS = [
    {
      id: 'LinkedIn',
      origin: 'https://www.linkedin.com',
      match: h => /(^|\.)linkedin\.com$/.test(h),
      /* every job link carries either ?currentJobId=<id> or /jobs/view/<id> */
      anchors: 'a[href*="currentJobId="], a[href*="/jobs/view/"]',
      idOf: href => (String(href).match(/\/jobs\/view\/(\d+)/)
        || String(href).match(/currentJobId=(\d+)/) || [])[1] || '',
      urlOf: (id) => 'https://www.linkedin.com/jobs/view/' + id + '/',
      virtualized: true,
    },
    {
      id: 'Bayt',
      origin: 'https://www.bayt.com',
      match: h => /(^|\.)bayt\.com$/.test(h),
      /* a Bayt posting ends in its own numeric id:
         /en/uae/jobs/senior-solutions-engineer-5123456/  — category links
         (…-jobs/) have no numeric tail, so they drop out on their own */
      anchors: 'a[href*="/jobs/"]',
      idOf: href => (String(href).split(/[?#]/)[0].match(/-(\d+)\/?$/) || [])[1] || '',
      urlOf: (id, href, origin) => absUrl(href, origin),
    },
    {
      id: 'GulfTalent',
      origin: 'https://www.gulftalent.com',
      match: h => /(^|\.)gulftalent\.com$/.test(h),
      /* same shape: /uae/jobs/senior-solutions-engineer-123456 */
      anchors: 'a[href*="/jobs/"]',
      idOf: href => (String(href).split(/[?#]/)[0].match(/-(\d+)\/?$/) || [])[1] || '',
      urlOf: (id, href, origin) => absUrl(href, origin),
    },
  ];

  function hostOf(loc) {
    try { return String((loc && loc.hostname) || '').toLowerCase(); } catch (e) { return ''; }
  }

  /* which portal is this page? ALWAYS by the page's own hostname — never by
     the caller's hint, so a saved search pointing somewhere else can't be read
     as if it were a job board. The hint only has to AGREE. */
  function portalFor(loc, hint) {
    const p = PORTALS.find(x => x.match(hostOf(loc))) || null;
    if (!p) return null;
    return (hint && p.id !== hint) ? null : p;
  }

  /* ---------- generic card reading (Bayt / GulfTalent — unchanged) ---------- */

  /* how many DISTINCT postings live under this element. Climbing past 1 means
     we have left the card and entered the results list — the guard that stops a
     card from borrowing the next job's company or location. (Two anchors for the
     SAME job — the title link and the logo link — still count as one.) */
  function jobsUnder(el, portal) {
    const ids = new Set();
    try {
      el.querySelectorAll(portal.anchors).forEach(a => {
        const id = portal.idOf(a.getAttribute('href') || '');
        if (id) ids.add(id);
      });
    } catch (e) { /* treat an unreadable subtree as a single card */ }
    return ids.size;
  }

  /* the visible parent card of a job link: the nearest list item / card-ish
     container, else the first ancestor holding more than one line of text —
     structural, so it survives a portal's class-name churn */
  function nearestCard(anchor, portal) {
    let el = anchor;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (jobsUnder(el, portal) > 1) break;                 // climbed into the list
      if (el.tagName === 'LI' || el.tagName === 'ARTICLE') return el;
      if (el.hasAttribute && (el.hasAttribute('data-occludable-job-id') || el.hasAttribute('data-job-id')
        || el.hasAttribute('data-js-job'))) return el;
      const cls = String((el.getAttribute && el.getAttribute('class')) || '');
      if (/job/i.test(cls) && /(card|listing|item|row|result|tile|post|entry)/i.test(cls)) return el;
    }
    el = anchor.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      if (jobsUnder(el, portal) > 1) break;
      if ((el.innerText || '').split('\n').filter(s => s.trim()).length >= 2) return el;
      el = el.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  /* boilerplate that appears in a card but is never company or location */
  const CARD_NOISE = /^(easy apply|promoted|viewed|saved?|save|apply|quick apply|actively (reviewing|hiring)|be an early applicant|reposted|new|featured|premium|confidential|with verification|show more|hiring|am i a good fit\??|·|\+?\d+ (applicants?|connections?|school alumni|alum.*)|.*\bago\b.*|\d+ days? left.*|·.*)$/i;

  const looksLikeLocation = l =>
    /,/.test(l) || /\((remote|hybrid|on-?site)\)/i.test(l)
    || /\b(remote|hybrid|on-?site)\b/i.test(l)
    || /\b(united arab emirates|saudi arabia|uae|ksa|qatar|kuwait|bahrain|oman|jordan|lebanon|egypt|pakistan|india|dubai|abu dhabi|sharjah|riyadh|jeddah|dammam|khobar|doha|manama|muscat|kuwait city|cairo|karachi|lahore|amman)\b/i.test(l);

  function firstIn(root, sels) {
    for (const s of sels) {
      const el = root && root.querySelector ? root.querySelector(s) : null;
      if (el && txt(el)) return txt(el);
    }
    return '';
  }

  /* company + location WITHOUT relying on class names: read the card's text
     lines, drop the title and the boilerplate, take what's left. A couple of
     per-portal class hints are tried first, only as a fast path. */
  function extractCompanyLocation(card, title) {
    let company = undouble(firstIn(card, [
      '.job-card-container__primary-description', '.artdeco-entity-lockup__subtitle',
      '.job-card-container__company-name', '.job-card-list__company-name',
      '.jb-company', '[class*="company" i]',
    ]));
    let location = undouble(firstIn(card, [
      '.job-card-container__metadata-item', '.job-card-container__metadata-wrapper li',
      '.artdeco-entity-lockup__caption',
      '.jb-loc', '[class*="location" i]',
    ]));
    if (company && location) return { company, location };

    const t = undouble(title);
    const lines = ((card && card.innerText) || '').split('\n').map(s => s.trim())
      .filter(Boolean)
      .filter(l => undouble(l) !== t && !CARD_NOISE.test(l));

    if (!company) company = lines.find(l => !looksLikeLocation(l)) || lines[0] || '';
    if (!location) location = lines.find(l => l !== company && looksLikeLocation(l))
      || lines.filter(l => l !== company)[0] || '';
    return { company, location };
  }

  /* one pass over a page that renders its whole results list at once */
  function collectGeneric(root, portal) {
    const anchors = Array.from(root.querySelectorAll(portal.anchors));
    const seen = new Set();
    const jobs = [];
    let candidates = 0, failed = 0;

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const id = portal.idOf(href);
      if (!id || seen.has(id)) continue;                       // one card per portal job id
      candidates++;

      const card = nearestCard(a, portal);
      if (!rendered(card)) continue;                           // display:none has no client rects

      const title = undouble(firstLine(txt(a)) || a.getAttribute('aria-label') || '');
      const url = portal.urlOf(id, href, portal.origin);
      if (!title || title.length > 160 || !url) { failed++; continue; }

      const { company, location } = extractCompanyLocation(card, title);
      seen.add(id);
      jobs.push({ title, company, location, url, source: portal.id, sourceJobId: portal.id.toLowerCase() + '-' + id });
    }
    return { jobs, candidates, failed, ids: seen };
  }

  /* ================= LINKEDIN: the virtualized left results list ================= */

  const LI = {
    MAX_JOBS: 50,          // hard cap on one harvest
    MAX_ROUNDS: 40,        // absolute stop, whatever else happens
    IDLE_ROUNDS: 3,        // stop after this many rounds with no new job id
    SCROLL_WAIT: 700,      // let the occlusion manager render after a scroll
    FIRST_CARD_WAIT: 9000, // a freshly opened background tab needs a moment
    FIRST_CARD_POLL: 300,
  };

  /* the job-details panel on the RIGHT carries its own /jobs/view/ links (the
     open posting, "similar jobs", the apply button). None of them are results. */
  const LI_DETAILS = '.jobs-search__job-details, .jobs-search__job-details--container, '
    + '.jobs-details, .jobs-details__main-content, .job-view-layout, .jobs-search__right-rail, '
    + '.scaffold-layout__detail, [class*="jobs-search__job-details"], [class*="job-details-jobs-unified"]';

  /* known left-list containers, newest markup first — only a fast path; the
     occludable list items below are the signal we actually trust */
  const LI_LIST_SELECTORS = [
    'ul.scaffold-layout__list-container',
    'div.scaffold-layout__list',
    '.jobs-search-results-list',
    '.jobs-search__results-list',
    'ul.jobs-search-results__list',
  ];

  const LI_CARD_SELECTORS = 'li[data-occludable-job-id], [data-job-id], '
    + 'li.scaffold-layout__list-item, li.jobs-search-results__list-item, div.job-card-container';

  function inDetails(el) {
    try { return !!(el && el.closest && el.closest(LI_DETAILS)); } catch (e) { return false; }
  }

  /* the LEFT results list, never the details panel. The occludable <li>s are
     LinkedIn's own marker for the results list, so when they exist their shared
     parent IS the list; otherwise fall back to the known containers, then to a
     list-shaped ancestor of the job links. */
  function resultsList(root) {
    const occ = Array.from(root.querySelectorAll('li[data-occludable-job-id]')).filter(el => !inDetails(el));
    if (occ.length) return occ[0].parentElement || root;

    for (const sel of LI_LIST_SELECTORS) {
      let el = null;
      try { el = root.querySelector(sel); } catch (e) { el = null; }
      if (el && !inDetails(el) && el.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]')) return el;
    }

    /* last resort: the closest UL/OL holding at least two distinct job links */
    const links = Array.from(root.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]'))
      .filter(a => !inDetails(a));
    for (const a of links) {
      let n = a.parentElement;
      for (let i = 0; i < 8 && n; i++) {
        if ((n.tagName === 'UL' || n.tagName === 'OL') && !inDetails(n)) {
          const ids = new Set();
          n.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').forEach(x => {
            const m = String(x.getAttribute('href') || '').match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
            if (m) ids.add(m[1] || m[2]);
          });
          if (ids.size >= 2) return n;
        }
        n = n.parentElement;
      }
    }
    return root;
  }

  /* A card holds SEVERAL links to the same job — the company logo first, then
     the title. Take the one that actually carries text, or the title is read as
     empty and a perfectly good card is counted as failed. */
  function jobLink(card) {
    let links = [];
    try { links = Array.from(card.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]')); }
    catch (e) { return null; }
    if (!links.length) return null;
    const speaks = a => {
      try { return !!(txt(a.querySelector('span[aria-hidden="true"], strong')) || txt(a) || a.getAttribute('aria-label')); }
      catch (e) { return false; }
    };
    return links.find(speaks) || links[0];
  }

  function cardJobId(card) {
    const attr = (card.getAttribute && (card.getAttribute('data-occludable-job-id')
      || card.getAttribute('data-job-id'))) || '';
    if (/^\d+$/.test(String(attr).trim())) return String(attr).trim();
    const link = jobLink(card);
    if (!link) return '';
    const href = link.getAttribute('href') || '';
    return (href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/) || [])[1] || '';
  }

  /* the title, taking the visible span rather than the doubled link text */
  function cardTitle(card) {
    const link = jobLink(card);
    if (!link) return '';
    let t = '';
    try {
      const vis = link.querySelector('span[aria-hidden="true"], strong');
      t = txt(vis);
    } catch (e) { /* fall through */ }
    t = undouble(t || txt(link) || link.getAttribute('aria-label') || '');
    return t.replace(/\s*with verification$/i, '').trim();
  }

  /* every LEFT-LIST card currently in the DOM (virtualization means this set
     changes between rounds — that is the whole point of scrolling) */
  function linkedInCards(list) {
    const out = [];
    const claimed = new Set();
    let els = [];
    try { els = Array.from(list.querySelectorAll(LI_CARD_SELECTORS)); } catch (e) { els = []; }

    els.forEach(el => {
      if (inDetails(el)) return;
      /* a card container nested inside an already-claimed <li> is the same job */
      if (out.some(c => c.el !== el && c.el.contains && c.el.contains(el))) return;
      const id = cardJobId(el);
      out.push({ el, id });
      if (id) claimed.add(id);
    });

    /* anything the card selectors missed: a bare job link in the list */
    let links = [];
    try { links = Array.from(list.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]')); }
    catch (e) { links = []; }
    links.forEach(a => {
      if (inDetails(a)) return;
      const href = a.getAttribute('href') || '';
      const id = (href.match(/\/jobs\/view\/(\d+)/) || href.match(/currentJobId=(\d+)/) || [])[1] || '';
      if (!id || claimed.has(id)) return;
      if (out.some(c => c.el.contains && c.el.contains(a))) return;
      claimed.add(id);
      out.push({ el: a.closest('li') || a.parentElement || a, id });
    });

    return out;
  }

  /* one pass over whatever the virtualized list has rendered right now */
  function collectLinkedInPass(root, portal) {
    const list = resultsList(root);
    const cards = linkedInCards(list);
    const pass = { jobs: [], ids: [], noIdCards: 0 };

    cards.forEach(({ el, id }) => {
      if (!id) { if (rendered(el)) pass.noIdCards++; return; }
      pass.ids.push(id);
      if (!rendered(el)) return;                       // an empty occludable placeholder
      const title = cardTitle(el);
      if (!title || title.length > 160) return;        // rendered but not filled in yet
      const { company, location } = extractCompanyLocation(el, title);
      pass.jobs.push({
        title, company, location,
        url: portal.urlOf(id),
        source: portal.id,
        sourceJobId: portal.id.toLowerCase() + '-' + id,
      });
    });
    return { list, pass };
  }

  /* ---------- scrolling the results container ---------- */

  function scrollableAncestor(el) {
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      try {
        const view = n.ownerDocument && n.ownerDocument.defaultView;
        const st = (view && view.getComputedStyle) ? view.getComputedStyle(n) : null;
        const oy = st ? st.overflowY : '';
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 20) return n;
      } catch (e) { /* keep climbing */ }
      n = n.parentElement;
    }
    return null;
  }

  /* Advance the results list by roughly one screen. LinkedIn's occlusion
     manager renders on scroll, so we nudge the scroll container AND pull the
     last rendered card into view — whichever the page actually listens to. */
  function scrollStep(list, lastCard) {
    let moved = false;
    const box = scrollableAncestor(list)
      || ((list && list.scrollHeight > list.clientHeight + 20) ? list : null);
    if (box) {
      const before = box.scrollTop;
      box.scrollTop = before + Math.max(240, Math.round((box.clientHeight || 600) * 0.85));
      moved = box.scrollTop !== before;
    }
    if (lastCard && lastCard.scrollIntoView) {
      try { lastCard.scrollIntoView({ block: 'center' }); moved = true; } catch (e) { /* older engines */ }
    }
    if (!moved && typeof window !== 'undefined' && window.scrollBy) {
      try { window.scrollBy(0, Math.max(320, (window.innerHeight || 800) * 0.85)); moved = true; } catch (e) { /* none */ }
    }
    return moved;
  }

  /* ---------- the LinkedIn harvest ---------- */

  /* Promoted postings appear twice: usually under the SAME job id (caught by the
     id key), occasionally as a separate promoted id for the same posting. The
     title+company+location key catches that second case; it keeps two genuinely
     different postings apart because their location or title differs. */
  const promotedKey = j => (j.title + '|' + j.company + '|' + j.location).toLowerCase().replace(/\s+/g, ' ').trim();

  async function harvestLinkedIn(root, loc, portal, opts) {
    const o = opts || {};
    const pick = (v, d) => (v == null ? d : v);          // 0 is a valid override
    const wait = o.sleep || sleep;
    const maxJobs = pick(o.maxJobs, LI.MAX_JOBS);
    const idleLimit = pick(o.idleRounds, LI.IDLE_ROUNDS);
    const maxRounds = pick(o.maxRounds, LI.MAX_ROUNDS);
    const scrollWait = pick(o.scrollWait, LI.SCROLL_WAIT);
    const firstCardPoll = pick(o.firstCardPoll, LI.FIRST_CARD_POLL);

    const byId = new Map();            // linkedin job id -> job
    const byPromoted = new Set();      // title|company|location — promoted twins
    const seenIds = new Set();         // every id seen on a card, parsed or not
    const droppedIds = new Set();      // promoted twins we deliberately skipped
    let noIdCards = 0;
    let rounds = 0, idle = 0;

    /* a freshly opened background tab has not rendered the list yet — wait for
       the first card before deciding anything (but bail out at once on a wall) */
    const deadline = (o.now ? o.now() : Date.now()) + pick(o.firstCardWait, LI.FIRST_CARD_WAIT);
    for (;;) {
      if (collectLinkedInPass(root, portal).pass.ids.length) break;
      if (blockerFor(root, loc, 0)) break;                       // login / CAPTCHA — stop waiting
      if ((o.now ? o.now() : Date.now()) >= deadline) break;
      await wait(firstCardPoll);
    }

    for (;;) {
      const { list, pass } = collectLinkedInPass(root, portal);
      pass.ids.forEach(id => seenIds.add(id));
      noIdCards = Math.max(noIdCards, pass.noIdCards);

      let added = 0;
      for (const job of pass.jobs) {
        const id = job.sourceJobId;
        if (byId.has(id)) continue;
        const pk = promotedKey(job);
        /* the promoted twin of a job we already have — dropped on purpose, so
           it must not later read as a card we FAILED to parse */
        if (pk !== '||' && byPromoted.has(pk)) { droppedIds.add(id); continue; }
        byId.set(id, job);
        byPromoted.add(pk);
        added++;
        if (byId.size >= maxJobs) break;
      }

      if (byId.size >= maxJobs) break;
      idle = added ? 0 : idle + 1;
      if (idle >= idleLimit) break;
      if (rounds >= maxRounds) break;

      rounds++;
      const cards = linkedInCards(list);
      const last = cards.length ? cards[cards.length - 1].el : null;
      scrollStep(list, last);
      await wait(scrollWait);
    }

    const jobs = Array.from(byId.values());
    const cardCandidates = seenIds.size + noIdCards;
    const diag = {
      scrollRounds: rounds,
      cardCandidates,
      uniqueIds: seenIds.size,
      parsed: jobs.length,
      /* a card we could not read — NOT one we deliberately dropped as a duplicate */
      failedCards: Math.max(0, cardCandidates - jobs.length - droppedIds.size),
    };
    return { jobs, diag };
  }

  /* ---------- login / CAPTCHA reporting (never worked around) ---------- */

  function rootText(root) {
    if (!root) return '';
    if (root.body) return ((root.body.innerText || '').slice(0, 6000) + ' ' + (root.title || '')).toLowerCase();
    return String(root.innerText || '').slice(0, 6000).toLowerCase();
  }

  /* A CAPTCHA is always terminal. A login/blocked signal only counts when the
     harvest found NOTHING — a signed-in results page still carries a "Sign in"
     link in its chrome, and that must not be mistaken for a wall. */
  function blockerFor(root, loc, jobCount) {
    if (!root || !root.querySelector) return 'blocked';
    const t = rootText(root);
    const url = String((loc && loc.href) || '').toLowerCase();

    if (root.querySelector('.g-recaptcha, [data-sitekey], #captcha, [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]')
      || /\brecaptcha\b|\bhcaptcha\b|verify you are human|i'm not a robot/.test(t)) return 'captcha';

    if (jobCount > 0) return null;                    // real results — not a wall

    if (/access denied|you (have been|are) blocked|are you a (human|robot)|just a moment\.\.\.|attention required|request blocked|error 403|unusual activity/i.test(t)) return 'blocked';

    const hasPassword = !!root.querySelector('input[type=password]');
    const signinText = /sign in to (?:see|view|continue)|join now|sign in|log in|\blogin\b|create (?:an )?account|forgot (your )?password|session (?:has )?expired/.test(t);
    const signinUrl = /\/(authwall|checkpoint|login|signin|sign-in|uas\/login|account\/login|register)\b/.test(url);
    if (signinUrl || (hasPassword && signinText)) return 'login';

    return null;
  }

  /* ---------- entry points ---------- */

  function resolve(o) {
    const root = o.root || (typeof document !== 'undefined' ? document : null);
    const loc = o.loc || (typeof location !== 'undefined' ? location : { href: '', hostname: '' });
    const portal = portalFor(loc, o.source);
    if (!root || !root.querySelectorAll) {
      return { error: { ok: false, source: o.source || null, jobs: [], found: 0, blocked: 'blocked', error: 'no page' } };
    }
    if (!portal) {
      const known = PORTALS.find(p => p.match(hostOf(loc)));
      return { error: { ok: false, source: o.source || null, jobs: [], found: 0, blocked: null,
        error: (known && o.source)
          ? `that page is on ${known.id}, not on ${o.source}`
          : 'that saved search is not on LinkedIn, Bayt or GulfTalent' } };
    }
    return { root, loc, portal };
  }

  /* ONE read of the page as it stands. This is the whole harvest for Bayt and
     GulfTalent (they render their results in one go) and a single round for
     LinkedIn. Synchronous, so it stays trivially testable. */
  function harvest(opts) {
    const o = opts || {};
    const r = resolve(o);
    if (r.error) return r.error;
    const { root, loc, portal } = r;

    let jobs, diag = null;
    if (portal.virtualized) {
      const { pass } = collectLinkedInPass(root, portal);
      jobs = pass.jobs;
      diag = { scrollRounds: 0, cardCandidates: pass.ids.length + pass.noIdCards,
        uniqueIds: new Set(pass.ids).size, parsed: jobs.length,
        failedCards: Math.max(0, pass.ids.length + pass.noIdCards - jobs.length) };
    } else {
      const g = collectGeneric(root, portal);
      jobs = g.jobs;
      diag = { scrollRounds: 0, cardCandidates: g.candidates, uniqueIds: g.ids.size, parsed: jobs.length, failedCards: g.failed };
    }

    const blocked = blockerFor(root, loc, jobs.length);
    if (blocked) return { ok: true, source: portal.id, jobs: [], found: 0, blocked, diag };
    return { ok: true, source: portal.id, jobs, found: jobs.length, blocked: null, diag };
  }

  /* THE FULL HARVEST the background worker asks for. LinkedIn scrolls its
     virtualized list; the other two take the single read above unchanged. */
  async function harvestList(opts) {
    const o = opts || {};
    const r = resolve(o);
    if (r.error) return r.error;
    const { root, loc, portal } = r;

    if (!portal.virtualized) return harvest(o);

    const { jobs, diag } = await harvestLinkedIn(root, loc, portal, o);

    const blocked = blockerFor(root, loc, jobs.length);
    if (blocked) return { ok: true, source: portal.id, jobs: [], found: 0, blocked, diag };

    /* Honesty gate: LinkedIn showed us a screen full of cards but we came away
       with (almost) nothing — that is a HARVEST FAILURE, not a run that found
       one job. Saving the single card would look like success and hide the
       breakage, which is exactly what happened the first time out. */
    if (jobs.length <= 1 && diag.cardCandidates >= 3) {
      return {
        ok: false, source: portal.id, jobs: [], found: 0, blocked: null, diag,
        error: `harvest failed — ${diag.cardCandidates} job cards on screen but only ${jobs.length} could be read `
          + `(${diag.scrollRounds} scroll round${diag.scrollRounds === 1 ? '' : 's'}, ${diag.uniqueIds} job ids seen). `
          + 'LinkedIn\'s results markup has probably changed.',
      };
    }

    /* Nothing at all — not even a placeholder. Either the results list never
       rendered in this background tab, or the list markup moved. A search that
       genuinely has no matches says so on the page, and THAT is a real zero. */
    if (!jobs.length && !diag.cardCandidates && !/no matching jobs found|no results found|we (?:couldn't|could not) find/i.test(rootText(root))) {
      return {
        ok: false, source: portal.id, jobs: [], found: 0, blocked: null, diag,
        error: 'harvest failed — no job cards were found in the results list, and the page does not say the search is empty. '
          + 'Open the saved search in Chrome and check it still shows results.',
      };
    }

    return { ok: true, source: portal.id, jobs, found: jobs.length, blocked: null, diag };
  }

  const api = {
    harvest, harvestList, blockerFor, portalFor, nearestCard, extractCompanyLocation,
    undouble, absUrl, PORTALS, LI,
    /* LinkedIn internals, exposed for the harness */
    resultsList, linkedInCards, cardJobId, cardTitle, scrollStep, collectLinkedInPass, promotedKey,
  };
  if (typeof window !== 'undefined') window.__cpHarvest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  /* answer the background worker's harvest request — only inside a real
     extension content script (a stubbed chrome in a harness has no runtime.id) */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'cp-harvest') return;
      harvestList({ source: msg.source })
        .then(sendResponse)
        .catch(e => sendResponse({ ok: false, jobs: [], found: 0, blocked: null, error: (e && e.message) || 'harvest failed' }));
      return true;                     // the scroll loop answers asynchronously
    });
  }
})();
