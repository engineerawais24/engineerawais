/* ============================================================
   Job Discovery v1 — extension harness.

   Real harvest.js against mock LinkedIn / Bayt / GulfTalent results pages, and
   real fetch-jobs.js + background.js with stubbed tabs / scripting / HTTP.
   Touches no network, no real tab and no website storage.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const H = window.__cpHarvest;

  /* ---------- mock portal pages (laid out off-screen, so rects are real) ---------- */

  function stage(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.getElementById('stage').appendChild(el);
    return el;
  }
  const timers = [];
  function clearStage() {
    while (timers.length) clearInterval(timers.pop());
    document.getElementById('stage').innerHTML = '';
  }
  const loc = href => ({ href, hostname: new URL(href).hostname });

  /* ---------- a VIRTUALIZED LinkedIn results list ----------
     The real page keeps only the cards near the viewport in the DOM: scroll
     down and new cards are created while the ones you scrolled past are
     DESTROYED. That is why a single read of a freshly opened tab saw one job.
     This mock behaves the same way — `ul` is rebuilt from scrollTop, so a card
     that scrolls out of the window is genuinely removed from the document. */
  function virtualList(opts) {
    const o = opts || {};
    const total = o.total == null ? 60 : o.total;
    const win = o.window || 8;
    const rowH = 100;
    const boxH = 420;

    const host = stage(`
      <div class="scaffold-layout__list" id="li-scroll" style="height:${boxH}px; overflow-y:auto; position:relative">
        <ul class="scaffold-layout__list-container" id="li-ul"></ul>
      </div>
      <div class="jobs-search__job-details" id="li-details">
        <h2>Network Security Engineer</h2>
        <a href="/jobs/view/999999/?from=details">The open posting</a>
        <a href="/jobs/view/888888/">A similar job, in the details pane</a>
      </div>`);
    const box = host.querySelector('#li-scroll');
    const ul = host.querySelector('#li-ul');

    const jobs = [];
    for (let i = 0; i < total; i++) {
      jobs.push(o.jobAt ? o.jobAt(i) : {
        id: String(4438320000 + i),
        title: 'Network Security Engineer ' + i,
        company: 'Company ' + i,
        location: 'Riyadh, Saudi Arabia',
      });
    }

    const card = j => `
      <li data-occludable-job-id="${j.id}" class="scaffold-layout__list-item" style="height:${rowH}px">
        <div class="job-card-container">
          <a class="logo" href="/jobs/view/${j.id}/?trk=logo"><img alt=""></a>
          <a class="job-card-container__link" href="/jobs/view/${j.id}/?eBP=abc&amp;refId=def">
            <span aria-hidden="true"><strong>${j.title}</strong></span><span class="visually-hidden">${j.title}</span>
          </a>
          <div class="artdeco-entity-lockup__subtitle">${j.company}</div>
          <ul class="job-card-container__metadata-wrapper"><li>${j.location}</li></ul>
          ${j.promoted ? '<div class="job-card-container__footer-item">Promoted</div>' : ''}
        </div>
      </li>`;

    let lastStart = -1;
    function renderWindow() {
      const start = Math.max(0, Math.min(Math.max(0, total - win), Math.floor(box.scrollTop / rowH)));
      if (start === lastStart) return;
      lastStart = start;
      const slice = jobs.slice(start, start + win);
      ul.innerHTML =
        `<li style="height:${start * rowH}px" aria-hidden="true"></li>`
        + slice.map(card).join('')
        + `<li style="height:${Math.max(0, (total - start - slice.length)) * rowH}px" aria-hidden="true"></li>`;
    }
    renderWindow();
    box.addEventListener('scroll', renderWindow);
    /* the real occlusion manager is observer-driven and repaints on its own
       schedule; a small poll makes this mock converge the same way */
    timers.push(setInterval(renderWindow, 5));

    return { host, box, ul, jobs, rendered: () => ul.querySelectorAll('li[data-occludable-job-id]').length };
  }

  /* fast, deterministic knobs for the scroll loop */
  const FAST = { sleep: () => new Promise(r => setTimeout(r, 16)), scrollWait: 0, firstCardWait: 0, firstCardPoll: 0 };

  const LI_LOC = loc('https://www.linkedin.com/jobs/search/?keywords=solutions%20engineer');
  const BAYT_LOC = loc('https://www.bayt.com/en/uae/jobs/solutions-engineer-jobs/');
  const GT_LOC = loc('https://www.gulftalent.com/uae/jobs/title/solutions-engineer');

  /* LinkedIn: <li> cards, doubled link text, a logo anchor for the same job,
     and one card that is not rendered */
  const LINKEDIN_HTML = `
    <ul class="jobs-search__results-list">
      <li data-occludable-job-id="4021">
        <a href="/jobs/view/4021/?currentJobId=4021" class="logo"><img alt=""></a>
        <a href="/jobs/view/4021/?currentJobId=4021"><span aria-hidden="true">Senior Solutions Engineer</span><span class="visually-hidden">Senior Solutions Engineer</span></a>
        <div class="job-card-container__primary-description">Careem</div>
        <div class="job-card-container__metadata-item">Dubai, United Arab Emirates</div>
        <div class="job-card-container__footer-item">Easy Apply</div>
      </li>
      <li data-occludable-job-id="4022">
        <a href="/jobs/view/4022/?currentJobId=4022"><span aria-hidden="true">Cloud Consultant</span><span class="visually-hidden">Cloud Consultant</span></a>
        <div class="job-card-container__primary-description">stc</div>
        <div class="job-card-container__metadata-item">Riyadh, Saudi Arabia</div>
      </li>
      <li data-occludable-job-id="4023" style="display:none">
        <a href="/jobs/view/4023/?currentJobId=4023">Not Rendered Yet</a>
        <div class="job-card-container__primary-description">Ghost Co</div>
      </li>
    </ul>`;

  /* Bayt: numeric id in the URL tail; a category link with no id must be ignored */
  const BAYT_HTML = `
    <ul>
      <li data-js-job="">
        <h2 class="jb-title"><a href="/en/uae/jobs/cloud-consultant-5123456/">Cloud Consultant</a></h2>
        <b class="jb-company">stc</b>
        <div class="jb-loc">Riyadh, Saudi Arabia</div>
        <div class="jb-date">30+ days ago</div>
      </li>
      <li data-js-job="">
        <h2 class="jb-title"><a href="/en/uae/jobs/solutions-architect-5199999/">Solutions Architect</a></h2>
        <b class="jb-company">Aramco</b>
        <div class="jb-loc">Dhahran, Saudi Arabia</div>
      </li>
    </ul>
    <a href="/en/uae/jobs/cloud-consultant-jobs/">All Cloud Consultant jobs</a>`;

  /* GulfTalent: no useful class names inside the card — forces the structural,
     line-based company/location read */
  const GT_HTML = `
    <div class="results">
      <div class="job-listing">
        <div><a href="/uae/jobs/platform-engineer-778899">Platform Engineer</a></div>
        <div>Majid Al Futtaim</div>
        <div>Dubai, UAE</div>
        <div>Posted 3 days ago</div>
      </div>
      <div class="job-listing">
        <div><a href="/uae/jobs/devops-lead-778900">DevOps Lead</a></div>
        <div>Emirates NBD</div>
        <div>Abu Dhabi, UAE</div>
      </div>
    </div>`;

  const LOGIN_HTML = `
    <div>
      <h1>Sign in to LinkedIn</h1>
      <p>Join now to see jobs picked for you</p>
      <form><input type="text" name="session_key"><input type="password" name="session_password"><button>Sign in</button></form>
    </div>`;

  /* ---------- a fake browser + backend for the orchestrator ---------- */

  function fakeCtx(opts) {
    const o = opts || {};
    const calls = { opened: [], closed: [], posts: [], sets: {} };
    return {
      calls,
      openTab: async url => {
        calls.opened.push(url);
        if (o.openFails && o.openFails.some(f => url.indexOf(f) !== -1)) throw new Error('could not open that saved search');
        return 'tab-' + calls.opened.length;
      },
      harvest: async (tabId, source) => {
        if (o.harvestFails && o.harvestFails.indexOf(source) !== -1) throw new Error('the page did not answer');
        if (o.harvest) return o.harvest(tabId, source);      // per-tab control
        return (o.harvests || {})[source] || { ok: true, source, jobs: [], found: 0, blocked: null };
      },
      closeTab: async id => { calls.closed.push(id); return true; },
      post: async body => {
        calls.posts.push(body);
        if (o.postThrowsFor && o.postThrowsFor(body)) throw new Error('backend unreachable');
        return { status: o.statusFor ? o.statusFor(body) : 201 };
      },
      set: async (k, v) => { calls.sets[k] = v; return { ok: true }; },
      now: () => 1754092800000,
    };
  }

  const job = (source, id, url, over) => Object.assign({
    title: 'Role ' + id, company: 'Co ' + id, location: 'Dubai',
    url, source, sourceJobId: source.toLowerCase() + '-' + id,
  }, over || {});

  /* Bayt fans out into one tab per keyword family; cases whose subject is the
     multi-portal run pin it to a single query so their tab counts stay about
     the portals, not the fan-out (the fan-out has its own cases, B1-B3). */
  const ONE_BAYT = ['cybersecurity'];

  const harvested = (source, jobs) => ({ ok: true, source, jobs, found: jobs.length, blocked: null });

  const ALL_SOURCES = [
    { id: 'LinkedIn', url: LI_LOC.href },
    { id: 'Bayt', url: BAYT_LOC.href },
    { id: 'GulfTalent', url: GT_LOC.href },
  ];

  /* ---------- cases ---------- */

  const CASES = [

    ['1 · LinkedIn search page → title, company, location, URL, source, source job id', () => {
      const root = stage(LINKEDIN_HTML);
      const r = H.harvest({ root, loc: LI_LOC });
      assert(r.ok && !r.blocked, 'a rendered results page is not blocked');
      assert(r.found === 2, 'two rendered cards expected, got ' + r.found);
      const a = r.jobs[0];
      assert(a.title === 'Senior Solutions Engineer', 'doubled link text must be halved: ' + a.title);
      assert(a.company === 'Careem', 'company: ' + a.company);
      assert(a.location === 'Dubai, United Arab Emirates', 'location: ' + a.location);
      assert(a.url === 'https://www.linkedin.com/jobs/view/4021/', 'canonical job URL: ' + a.url);
      assert(a.source === 'LinkedIn' && a.sourceJobId === 'linkedin-4021', 'source + portal job id');
      assert(!r.jobs.some(j => j.company === 'Ghost Co'), 'an unrendered card must not be harvested');
      return '2 jobs · all six fields · hidden card skipped';
    }],

    /* ---- the regression the live run exposed: 99+ results, 1 job harvested ---- */

    ['1a · VIRTUALIZED LinkedIn list: scrolling collects the jobs a single read misses', async () => {
      const v = virtualList({ total: 30 });
      /* what v1 did — one read of the freshly opened tab */
      const single = H.harvest({ root: v.host, loc: LI_LOC });
      assert(single.found <= v.rendered(), 'a single read can only ever see the rendered window');
      assert(single.found < 30, 'the whole point: one read cannot see 30 virtualized cards, saw ' + single.found);

      const r = await H.harvestList(Object.assign({ root: v.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(r.ok && !r.blocked, 'the scrolled harvest should succeed: ' + JSON.stringify(r.error || ''));
      assert(r.found === 30, 'all 30 virtualized jobs should be collected, got ' + r.found);
      assert(v.rendered() < 30, 'and the DOM never held them all at once (' + v.rendered() + ' rendered)');

      const first = r.jobs[0];
      assert(/^Network Security Engineer/.test(first.title), 'title: ' + first.title);
      assert(/^Company /.test(first.company) && first.location === 'Riyadh, Saudi Arabia', 'company/location: ' + JSON.stringify(first));
      assert(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/$/.test(first.url), 'exact /jobs/view/<id>/ URL: ' + first.url);
      assert(first.sourceJobId === 'linkedin-' + first.url.match(/(\d+)/)[1], 'source job id tracks the LinkedIn id');
      assert(new Set(r.jobs.map(j => j.sourceJobId)).size === 30, 'every job id is distinct');
      return `single read ${single.found} → scrolled ${r.found}/30 · ${r.diag.scrollRounds} rounds`;
    }],

    ['1b · Scrolling stops at 50 unique jobs, and after 3 idle rounds', async () => {
      const big = virtualList({ total: 80 });
      const capped = await H.harvestList(Object.assign({ root: big.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(capped.found === 50, 'the 50-job cap must hold, got ' + capped.found);
      clearStage();

      const small = virtualList({ total: 12 });
      const done = await H.harvestList(Object.assign({ root: small.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(done.found === 12, 'a short list is collected whole, got ' + done.found);
      /* it stopped on the idle rule, not by exhausting the round budget */
      assert(done.diag.scrollRounds < H.LI.MAX_ROUNDS, 'it should stop on 3 idle rounds, not the round cap');
      return `cap 50/80 · idle-stop at 12 after ${done.diag.scrollRounds} rounds`;
    }],

    ['1c · Only the LEFT results list is read — never the job-details panel', async () => {
      const v = virtualList({ total: 10 });
      const r = await H.harvestList(Object.assign({ root: v.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      const ids = r.jobs.map(j => j.sourceJobId);
      assert(ids.indexOf('linkedin-999999') === -1, 'the open posting in the details panel is not a result');
      assert(ids.indexOf('linkedin-888888') === -1, 'a "similar job" in the details panel is not a result');
      assert(r.found === 10, 'and the real results are all still collected, got ' + r.found);

      /* the list finder must resolve to the left <ul>, not the whole document */
      const list = H.resultsList(v.host);
      assert(list && list.id === 'li-ul', 'resultsList should be the left results list, got ' + (list && (list.id || list.tagName)));
      return 'details-pane links excluded · 10/10 results';
    }],

    ['1d · Promoted duplicates are collected once', async () => {
      /* LinkedIn shows a promoted card AND the organic card: usually the same
         job id, sometimes a second id for the same posting */
      const v = virtualList({
        total: 6, window: 8,
        jobAt: i => {
          if (i === 1) return { id: '4438320000', title: 'Network Security Engineer 0', company: 'Company 0', location: 'Riyadh, Saudi Arabia', promoted: true };
          if (i === 2) return { id: '7000000001', title: 'Network Security Engineer 0', company: 'Company 0', location: 'Riyadh, Saudi Arabia', promoted: true };
          return { id: String(4438320000 + i), title: 'Network Security Engineer ' + i, company: 'Company ' + i, location: 'Riyadh, Saudi Arabia' };
        },
      });
      const r = await H.harvestList(Object.assign({ root: v.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      const titles = r.jobs.map(j => j.title);
      assert(titles.filter(t => t === 'Network Security Engineer 0').length === 1,
        'the promoted twin must not be saved twice: ' + JSON.stringify(titles));
      assert(r.jobs.filter(j => j.sourceJobId === 'linkedin-4438320000').length === 1, 'the repeated id is collected once');
      assert(r.found === 4, 'six cards, two of them the same posting → four jobs, got ' + r.found);
      return 'same id and same title/company/location → one job';
    }],

    ['1e · Cards on screen but nothing readable → reported as a FAILURE, not 1 job', async () => {
      /* exactly what the live run hit: the occludable placeholders exist, but
         only the selected card has been filled in, and scrolling reveals none */
      const placeholders = Array.from({ length: 9 },
        (_, i) => `<li data-occludable-job-id="${5550000 + i}" class="scaffold-layout__list-item" style="height:100px"></li>`).join('');
      const root = stage(`
        <div class="scaffold-layout__list" style="height:400px; overflow-y:auto">
          <ul class="scaffold-layout__list-container">
            <li data-occludable-job-id="4438320203" class="scaffold-layout__list-item">
              <div class="job-card-container">
                <a class="job-card-container__link" href="/jobs/view/4438320203/"><span aria-hidden="true">Network Security Engineer</span></a>
                <div class="artdeco-entity-lockup__subtitle">Elm</div>
              </div>
            </li>
            ${placeholders}
          </ul>
        </div>`);

      const r = await H.harvestList(Object.assign({ root, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(r.ok === false, 'one job out of ten cards must NOT be reported as success');
      assert(/harvest failed/i.test(r.error) && /10 job cards/.test(r.error), 'the error must name the numbers: ' + r.error);
      assert(r.found === 0 && r.jobs.length === 0, 'nothing is saved from a failed harvest');
      assert(r.diag.cardCandidates === 10 && r.diag.uniqueIds === 10 && r.diag.parsed === 1 && r.diag.failedCards === 9,
        'diagnostics must be exact: ' + JSON.stringify(r.diag));
      return 'candidates 10 · parsed 1 → failure, not success';
    }],

    ['1e2 · An empty results list is a failure — unless the page says the search is empty', async () => {
      /* the list never rendered (a background tab that stayed blank, or moved
         markup): reporting "found 0" would look like a search with no matches */
      const blank = stage('<div class="scaffold-layout__list"><ul class="scaffold-layout__list-container"></ul></div>');
      const r = await H.harvestList(Object.assign({ root: blank, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(r.ok === false && /no job cards were found/.test(r.error), 'a blank list must be a failure: ' + JSON.stringify(r));
      clearStage();

      /* a search that really has no matches says so — that zero is honest */
      const empty = stage('<div class="scaffold-layout__list"><h2>No matching jobs found</h2><ul class="scaffold-layout__list-container"></ul></div>');
      const ok = await H.harvestList(Object.assign({ root: empty, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(ok.ok === true && ok.found === 0 && !ok.error, 'a genuinely empty search is not a failure: ' + JSON.stringify(ok));
      return 'blank list → failure · "no matching jobs found" → honest 0';
    }],

    ['1f · Diagnostics: scroll rounds, card candidates, unique ids, parsed, failed', async () => {
      const v = virtualList({ total: 20 });
      const r = await H.harvestList(Object.assign({ root: v.host, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      const d = r.diag;
      assert(d, 'every harvest carries diagnostics');
      assert(['scrollRounds', 'cardCandidates', 'uniqueIds', 'parsed', 'failedCards'].every(k => typeof d[k] === 'number'),
        'all five diagnostics are numbers: ' + JSON.stringify(d));
      assert(d.scrollRounds >= 1, 'a 20-job virtualized list needs scrolling: ' + d.scrollRounds);
      assert(d.uniqueIds === 20 && d.parsed === 20 && d.failedCards === 0, 'clean read: ' + JSON.stringify(d));
      assert(d.cardCandidates >= d.parsed, 'candidates can never be fewer than parsed');

      /* Bayt still reports diagnostics from its single read — and is unchanged */
      const bayt = H.harvest({ root: stage(BAYT_HTML), loc: BAYT_LOC });
      assert(bayt.diag && bayt.diag.parsed === 2 && bayt.diag.scrollRounds === 0, 'Bayt: one read, no scrolling: ' + JSON.stringify(bayt.diag));
      return JSON.stringify(d);
    }],

    ['2 · Bayt search page → jobs; category links are not jobs', async () => {
      const root = stage(BAYT_HTML);
      const r = H.harvest({ root, loc: BAYT_LOC });
      assert(r.found === 2, 'two Bayt cards expected, got ' + r.found);
      /* Bayt renders its whole page, so the full harvest is the SAME single
         read — the LinkedIn scroll loop must not have changed it */
      const full = await H.harvestList({ root, loc: BAYT_LOC, source: 'Bayt' });
      assert(JSON.stringify(full.jobs) === JSON.stringify(r.jobs), 'harvestList must equal harvest for Bayt');
      const a = r.jobs[0];
      assert(a.title === 'Cloud Consultant' && a.company === 'stc' && a.location === 'Riyadh, Saudi Arabia', 'fields: ' + JSON.stringify(a));
      assert(a.url === 'https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/', 'absolute job URL: ' + a.url);
      assert(a.sourceJobId === 'bayt-5123456', 'portal job id: ' + a.sourceJobId);
      assert(r.jobs.every(j => !/-jobs\/$/.test(j.url)), 'a category link must never be saved as a job');
      return 'bayt-5123456 · absolute URL · category link ignored';
    }],

    ['3 · GulfTalent search page → jobs read structurally (no class hints)', async () => {
      const root = stage(GT_HTML);
      const r = H.harvest({ root, loc: GT_LOC });
      assert(r.found === 2, 'two GulfTalent cards expected, got ' + r.found);
      const full = await H.harvestList({ root, loc: GT_LOC, source: 'GulfTalent' });
      assert(JSON.stringify(full.jobs) === JSON.stringify(r.jobs), 'harvestList must equal harvest for GulfTalent');
      const a = r.jobs[0], b = r.jobs[1];
      assert(a.title === 'Platform Engineer' && a.company === 'Majid Al Futtaim' && a.location === 'Dubai, UAE',
        'first card: ' + JSON.stringify(a));
      assert(b.company === 'Emirates NBD' && b.location === 'Abu Dhabi, UAE',
        'the second card must not borrow the first card company: ' + JSON.stringify(b));
      assert(a.url === 'https://www.gulftalent.com/uae/jobs/platform-engineer-778899', 'job URL: ' + a.url);
      assert(a.sourceJobId === 'gulftalent-778899', 'portal job id: ' + a.sourceJobId);
      return 'card boundaries respected · ids parsed';
    }],

    ['4 · A login wall is reported, never worked around', () => {
      const root = stage(LOGIN_HTML);
      const r = H.harvest({ root, loc: LI_LOC });
      assert(r.blocked === 'login', 'a sign-in wall must report "login", got ' + r.blocked);
      assert(r.jobs.length === 0 && r.found === 0, 'nothing may be harvested from a login wall');
      return 'blocked=login · zero jobs';
    }],

    ['5 · A CAPTCHA is terminal even when cards are on screen', () => {
      const root = stage(LINKEDIN_HTML + '<div class="g-recaptcha" data-sitekey="x"></div>');
      const r = H.harvest({ root, loc: LI_LOC });
      assert(r.blocked === 'captcha', 'a CAPTCHA must report "captcha", got ' + r.blocked);
      assert(r.found === 0, 'nothing is harvested behind a CAPTCHA');
      return 'blocked=captcha · zero jobs';
    }],

    ['6 · A signed-in page with a "Sign in" link in its chrome is NOT flagged', () => {
      const root = stage('<nav><a href="/login">Sign in</a></nav>' + LINKEDIN_HTML);
      const r = H.harvest({ root, loc: LI_LOC });
      assert(r.blocked === null, 'real results must not be mistaken for a wall: ' + r.blocked);
      assert(r.found === 2, 'the jobs are still harvested');
      return 'results present → not blocked';
    }],

    ['7 · Harvesting never modifies the page — scrolled or not', async () => {
      const root = stage(LINKEDIN_HTML);
      const before = root.innerHTML;
      H.harvest({ root, loc: LI_LOC });
      assert(root.innerHTML === before, 'the results page was modified — the harvester must be read-only');

      /* the same holds for the scrolling LinkedIn path: it moves scroll
         position, it never touches the document */
      await H.harvestList(Object.assign({ root, loc: LI_LOC, source: 'LinkedIn' }, FAST));
      assert(root.innerHTML === before, 'the scrolled harvest modified the page');

      const bayt = stage(BAYT_HTML);
      const baytBefore = bayt.innerHTML;
      await H.harvestList(Object.assign({ root: bayt, loc: BAYT_LOC, source: 'Bayt' }, FAST));
      assert(bayt.innerHTML === baytBefore, 'the Bayt page was modified');
      return 'DOM byte-identical after a single read and after scrolling';
    }],

    ['8 · A saved search on some other site is refused', () => {
      const root = stage(LINKEDIN_HTML);
      const r = H.harvest({ root, loc: loc('https://www.indeed.com/jobs?q=engineer') });
      assert(r.ok === false && !r.jobs.length, 'an unsupported portal must harvest nothing');
      assert(/not on LinkedIn/.test(r.error || ''), 'and say so plainly: ' + r.error);
      return 'unsupported portal → honest refusal';
    }],

    ['9 · Deduplication by source job id AND by exact job URL', () => {
      const F = window.CPFetchJobs;
      const a = job('LinkedIn', '1', 'https://www.linkedin.com/jobs/view/1/');
      const sameId = job('LinkedIn', '1', 'https://www.linkedin.com/jobs/view/1/?trk=x');
      const sameUrlNewId = job('LinkedIn', '99', 'https://www.linkedin.com/jobs/view/1/');
      const other = job('Bayt', '7', 'https://www.bayt.com/en/uae/jobs/role-7/');

      const d = F.dedupe([a, sameId, sameUrlNewId, other]);
      assert(d.unique.length === 2, 'only two distinct postings survive, got ' + d.unique.length);
      assert(d.duplicate === 2, 'two duplicates expected, got ' + d.duplicate);

      /* the same URL surfaced by a second portal in the same run is a duplicate too */
      const cross = F.dedupe([job('GulfTalent', '5', 'https://www.bayt.com/en/uae/jobs/role-7/')], d.seen);
      assert(cross.unique.length === 0 && cross.duplicate === 1, 'cross-portal URL duplicate not caught');
      return 'id dedup · exact-URL dedup · cross-source dedup';
    }],

    ['10 · One run over three portals: found / saved / duplicate / failed', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({
        harvests: {
          LinkedIn: harvested('LinkedIn', [job('LinkedIn', '1', 'https://www.linkedin.com/jobs/view/1/'),
            job('LinkedIn', '2', 'https://www.linkedin.com/jobs/view/2/')]),
          Bayt: harvested('Bayt', [job('Bayt', '3', 'https://www.bayt.com/en/uae/jobs/role-3/')]),
          GulfTalent: harvested('GulfTalent', [job('GulfTalent', '4', 'https://www.gulftalent.com/uae/jobs/role-4')]),
        },
        /* the backend already holds job 2, and job 4 fails to save */
        statusFor: b => b.source_job_id === 'linkedin-2' ? 409 : (b.source_job_id === 'gulftalent-4' ? 500 : 201),
      });
      const r = await F.run({ token: 'tok-1', sources: ALL_SOURCES, baytQueries: ONE_BAYT }, ctx);
      assert(r.ok, 'the run should complete');
      assert(r.totals.found === 4, 'found: ' + r.totals.found);
      assert(r.totals.saved === 2, 'saved: ' + r.totals.saved);
      assert(r.totals.duplicate === 1, 'duplicate: ' + r.totals.duplicate);
      assert(r.totals.failed === 1, 'failed: ' + r.totals.failed);
      assert(ctx.calls.opened.length === 3 && ctx.calls.closed.length === 3, 'every tab opened is closed again');
      assert(ctx.calls.sets[F.RESULT_KEY], 'the finished run is written to storage for the app relay');
      return 'found 4 · saved 2 · duplicate 1 · failed 1 · 3 tabs closed';
    }],

    ['11 · A blocked source is Needs Attention; the other sources still run', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({
        harvests: {
          LinkedIn: { ok: true, source: 'LinkedIn', jobs: [], found: 0, blocked: 'login' },
          Bayt: { ok: true, source: 'Bayt', jobs: [], found: 0, blocked: 'captcha' },
          GulfTalent: harvested('GulfTalent', [job('GulfTalent', '4', 'https://www.gulftalent.com/uae/jobs/role-4')]),
        },
      });
      const r = await F.run({ token: 'tok-2', sources: ALL_SOURCES, baytQueries: ONE_BAYT }, ctx);
      /* Bayt rows are labelled 'Bayt · <keyword>', so match on the portal */
      const rowFor = p => r.sources.find(s => s.id === p || s.id.indexOf(p + ' ·') === 0);
      const li = rowFor('LinkedIn');
      const bayt = rowFor('Bayt');
      const gt = rowFor('GulfTalent');
      assert(li.status === 'needs-attention' && /sign-in/i.test(li.reason), 'login → needs attention: ' + JSON.stringify(li));
      assert(bayt.status === 'needs-attention' && /captcha/i.test(bayt.reason), 'captcha → needs attention: ' + JSON.stringify(bayt));
      assert(gt.status === 'ok' && gt.saved === 1, 'a healthy source still runs: ' + JSON.stringify(gt));
      assert(ctx.calls.posts.length === 1, 'nothing is saved from a blocked source');
      assert(r.attention.length === 2 && /^LinkedIn/.test(r.attention[0]) && /^Bayt/.test(r.attention[1]),
        'both blocked sources are listed: ' + r.attention.join(','));
      assert(ctx.calls.closed.length === 3, 'blocked tabs are closed too');
      return 'login + captcha → needs attention · third source unaffected';
    }],

    ['12 · A portal that fails is reported; the run still finishes', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({
        openFails: ['bayt.com'],
        harvestFails: ['GulfTalent'],
        harvests: { LinkedIn: harvested('LinkedIn', [job('LinkedIn', '1', 'https://www.linkedin.com/jobs/view/1/')]) },
      });
      const r = await F.run({ token: 'tok-3', sources: ALL_SOURCES, baytQueries: ONE_BAYT }, ctx);
      const rowFor = p => r.sources.find(s => s.id === p || s.id.indexOf(p + ' ·') === 0);
      assert(r.ok, 'the run completes despite two broken sources');
      assert(rowFor('Bayt').status === 'failed', 'a tab that will not open is a failed source');
      assert(rowFor('GulfTalent').status === 'failed', 'a page that does not answer is a failed source');
      assert(rowFor('LinkedIn').saved === 1, 'the working source still saved its job');
      return 'per-source failure isolated';
    }],

    ['13 · Only configured, valid saved searches are visited', async () => {
      const F = window.CPFetchJobs;
      assert(F.validSources([{ id: 'LinkedIn', url: LI_LOC.href }, { id: 'Bayt', url: '' },
        { id: 'Nope', url: 'https://example.com' }, { id: 'GulfTalent', url: 'not a url' }]).length === 1,
        'blank, unknown-portal and malformed URLs are dropped');
      assert(F.validSources([{ id: 'Bayt', url: BAYT_LOC.href }, { id: 'Bayt', url: BAYT_LOC.href }]).length === 1,
        'one saved search per portal');

      const ctx = fakeCtx({});
      const r = await F.run({ token: 'tok-4', sources: [] }, ctx);
      assert(r.ok === false && /no saved search/.test(r.error), 'nothing configured → an honest message: ' + r.error);
      assert(ctx.calls.opened.length === 0, 'no tab is opened when nothing is configured');
      return 'validated · nothing configured → no tabs';
    }],

    ['13b · A run can only ever open the three portals', async () => {
      const F = window.CPFetchJobs;
      /* a URL that does not belong to its portal is never visited — the fetch
         path cannot be pointed at another site */
      assert(F.validSources([{ id: 'LinkedIn', url: 'https://example.com/jobs' }]).length === 0,
        'an off-portal URL must be dropped before any tab opens');
      assert(F.validSources([{ id: 'Bayt', url: LI_LOC.href }]).length === 0,
        'a LinkedIn URL saved under Bayt is dropped');
      assert(F.onPortal('GulfTalent', GT_LOC.href) && !F.onPortal('GulfTalent', 'https://gulftalent.evil.com/'),
        'the host check is anchored, not a substring match');

      const ctx = fakeCtx({});
      const r = await F.run({ token: 'tok-4b', sources: [{ id: 'LinkedIn', url: 'https://example.com/jobs' }] }, ctx);
      assert(ctx.calls.opened.length === 0, 'no tab may be opened for an off-portal URL');
      assert(r.ok === false, 'and the run reports that nothing was configured');

      /* and even if a tab somehow lands elsewhere, the harvester refuses it */
      const root = stage(LINKEDIN_HTML);
      const wrong = H.harvest({ root, loc: BAYT_LOC, source: 'LinkedIn' });
      assert(wrong.ok === false && !wrong.jobs.length, 'the page must be read as the portal it actually is');
      return 'off-portal URLs never opened · host hint cannot override the real page';
    }],

    /* ---- Bayt: one run walks the keyword families ---- */

    ['B1 · One Bayt saved search becomes one tab per keyword family', () => {
      const F = window.CPFetchJobs;
      const expanded = F.expandSources([{ id: 'Bayt', url: BAYT_LOC.href }]);
      assert(expanded.length === F.BAYT_QUERIES.length,
        'one source per keyword, got ' + expanded.length + ' for ' + F.BAYT_QUERIES.length + ' keywords');

      ['network security engineer', 'cybersecurity', 'technical consultant',
        'solutions engineer', 'solutions architect', 'presales engineer',
        'infrastructure engineer', 'ICT', 'technical project manager',
        'OT cybersecurity', 'ICS security', 'physical security', 'PSIM',
      ].forEach(q => assert(F.BAYT_QUERIES.indexOf(q) !== -1, 'missing keyword family: ' + q));

      const first = expanded[0];
      assert(first.portal === 'Bayt', 'the portal stays Bayt so harvesting and host checks still work');
      assert(/^Bayt · /.test(first.id), 'the row is labelled by keyword: ' + first.id);
      assert(F.onPortal('Bayt', first.url), 'every generated URL is on bayt.com: ' + first.url);
      assert(/saudi-arabia/.test(first.url), 'and scoped to Saudi Arabia: ' + first.url);
      assert(F.baytSearchUrl('OT cybersecurity') === 'https://www.bayt.com/en/saudi-arabia/jobs/ot-cybersecurity-jobs/',
        'keyword → slug: ' + F.baytSearchUrl('OT cybersecurity'));
      assert(new Set(expanded.map(s => s.url)).size === expanded.length, 'every search URL is distinct');

      const gt = F.expandSources([{ id: 'GulfTalent', url: GT_LOC.href }]);
      assert(gt.length === 1 && gt[0].url === GT_LOC.href && gt[0].portal === 'GulfTalent',
        'GulfTalent must pass through unchanged: ' + JSON.stringify(gt));
      return F.BAYT_QUERIES.length + ' Bayt searches · other portals unchanged';
    }],

    ['B2 · A posting found under several keywords is saved once', async () => {
      const F = window.CPFetchJobs;
      const shared = job('Bayt', '5123456', 'https://www.bayt.com/en/saudi-arabia/jobs/nse-5123456/');
      const ctx = fakeCtx({
        /* every keyword search returns the SAME posting, plus one of its own */
        harvest: async (tabId) => harvested('Bayt', [shared,
          job('Bayt', 'x' + tabId, 'https://www.bayt.com/en/saudi-arabia/jobs/role-' + tabId + '/')]),
      });
      const r = await F.run({ token: 'tok-bayt', sources: [{ id: 'Bayt', url: BAYT_LOC.href }],
        baytQueries: ['network security engineer', 'cybersecurity', 'PSIM'] }, ctx);

      assert(ctx.calls.opened.length === 3, 'one tab per keyword, got ' + ctx.calls.opened.length);
      assert(r.totals.found === 6, 'all six harvested rows are counted as found: ' + r.totals.found);
      assert(ctx.calls.posts.length === 4, 'the repeat is never re-posted, got ' + ctx.calls.posts.length);
      assert(r.totals.saved === 4 && r.totals.duplicate === 2,
        'saved 4 · duplicate 2 expected, got ' + JSON.stringify(r.totals));
      const ids = ctx.calls.posts.map(p => p.source_job_id);
      assert(ids.filter(i => i === 'bayt-5123456').length === 1, 'the shared posting is saved exactly once');
      return '3 searches · shared posting deduped across them';
    }],

    ['B3 · A 422 is "filtered", not "failed"', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({
        harvest: async () => harvested('Bayt', [
          job('Bayt', '1', 'https://www.bayt.com/en/saudi-arabia/jobs/a-1/'),
          job('Bayt', '2', 'https://www.bayt.com/en/saudi-arabia/jobs/b-2/'),
          job('Bayt', '3', 'https://www.bayt.com/en/saudi-arabia/jobs/c-3/'),
        ]),
        statusFor: b => b.source_job_id === 'bayt-1' ? 201 : 422,
      });
      const r = await F.run({ token: 'tok-422', sources: [{ id: 'Bayt', url: BAYT_LOC.href }],
        baytQueries: ['cybersecurity'] }, ctx);

      assert(r.totals.saved === 1, 'saved: ' + r.totals.saved);
      assert(r.totals.filtered === 2, 'the two 422s are FILTERED, got ' + r.totals.filtered);
      assert(r.totals.failed === 0, 'and none counts as failed, got ' + r.totals.failed);
      assert(r.sources[0].status === 'ok', 'a filtered job never makes the source fail: ' + r.sources[0].status);

      /* a real server error IS still a failure */
      const broken = fakeCtx({
        harvest: async () => harvested('Bayt', [job('Bayt', '9', 'https://www.bayt.com/en/saudi-arabia/jobs/z-9/')]),
        statusFor: () => 500,
      });
      const bad = await F.run({ token: 'tok-500', sources: [{ id: 'Bayt', url: BAYT_LOC.href }],
        baytQueries: ['cybersecurity'] }, broken);
      assert(bad.totals.failed === 1 && bad.totals.filtered === 0,
        'a 500 is still a failure: ' + JSON.stringify(bad.totals));

      /* so is a transport error (no response at all) */
      const dead = fakeCtx({
        harvest: async () => harvested('Bayt', [job('Bayt', '8', 'https://www.bayt.com/en/saudi-arabia/jobs/y-8/')]),
        postThrowsFor: () => true,
      });
      const off = await F.run({ token: 'tok-dead', sources: [{ id: 'Bayt', url: BAYT_LOC.href }],
        baytQueries: ['cybersecurity'] }, dead);
      assert(off.totals.failed === 1 && off.totals.filtered === 0,
        'a transport error is still a failure: ' + JSON.stringify(off.totals));
      return '422 → filtered · 500 and transport errors → failed';
    }],

    ['14 · The saved payload is the existing POST /api/jobs contract', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({
        harvests: { Bayt: harvested('Bayt', [job('Bayt', '5123456', 'https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/', { title: 'Cloud Consultant', company: 'stc', location: 'Riyadh' })]) },
      });
      await F.run({ token: 'tok-5', sources: [{ id: 'Bayt', url: BAYT_LOC.href }] }, ctx);
      const body = ctx.calls.posts[0];
      assert(body.source === 'Bayt' && body.source_job_id === 'bayt-5123456', 'source + source_job_id');
      assert(body.title === 'Cloud Consultant' && body.company === 'stc' && body.location === 'Riyadh', 'visible fields');
      assert(body.apply_url === 'https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/', 'apply_url is the exact job URL');
      assert(body.canonical_url === body.apply_url, 'canonical_url carries no query string');
      assert(!('salary' in body) && !('description' in body), 'v1 saves only what was on screen');
      return 'payload matches the existing job endpoint';
    }],

    ['15 · background.js routes cp-fetch-jobs, and the queue path is unchanged', async () => {
      const B = window.CPBackground;
      let got = null;
      const runner = async msg => { got = msg; return { ok: true, token: msg.token, totals: { found: 1, saved: 1, duplicate: 0, failed: 0 }, sources: [] }; };
      const res = await B.handleMessage({ type: 'cp-fetch-jobs', token: 'tok-6', sources: ALL_SOURCES }, { fetchJobs: runner });
      assert(res.ok && res.totals.saved === 1, 'the worker returns the finished run: ' + JSON.stringify(res));
      assert(got && got.sources.length === 3, 'the saved searches reach the orchestrator');

      /* the Queue → ATS intent still works exactly as before */
      const stored = {};
      const q = await B.handleMessage({ type: 'cp-queue-open', url: 'https://boards.greenhouse.io/x/jobs/1', token: 'q1' },
        { set: async o => { Object.assign(stored, o); return { ok: true }; }, now: 1 });
      assert(q.ok && stored[B.PENDING] && stored[B.PENDING].token === 'q1', 'queue-open regression');
      return 'cp-fetch-jobs routed · cp-queue-open unchanged';
    }],

    ['16 · Nothing is applied to and nothing is submitted', async () => {
      const F = window.CPFetchJobs;
      const ctx = fakeCtx({ harvests: { LinkedIn: harvested('LinkedIn', [job('LinkedIn', '1', 'https://www.linkedin.com/jobs/view/1/')]) } });
      await F.run({ token: 'tok-7', sources: [{ id: 'LinkedIn', url: LI_LOC.href }] }, ctx);
      assert(ctx.calls.posts.every(b => b.source && b.apply_url), 'every request is a job save');
      const src = String(F.run) + String(F.runSource) + String(F.payloadFor);
      assert(!/submit|autofill|applicat/i.test(src.replace(/candidateApplication/gi, '')),
        'the fetcher must not touch autofill, applications or submission');
      return 'only POST /api/jobs · no autofill/submit code path';
    }],
  ];

  /* ---------- runner ---------- */

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function run() {
    const results = [];
    for (const [name, fn] of CASES) {
      clearStage();
      try { results.push({ name, pass: true, detail: (await fn()) || '' }); }
      catch (e) { results.push({ name, pass: false, detail: e.message }); }
    }
    clearStage();
    return results;
  }

  function render(results) {
    const passed = results.filter(r => r.pass).length;
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    document.getElementById('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Job fetch: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
