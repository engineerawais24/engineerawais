/* ============================================================
   "Fetch Jobs Now" — app-side browser harness (Job Discovery v1).

   Real JobFetchStore + JobFetch + JobFetchView + JobsBackendSync +
   ImportedJobs + AppStorage, with a stubbed backend transport standing in for
   the running FastAPI app and no Chrome extension present. localStorage is
   snapshotted and restored, so no real data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 0));
  /* window.postMessage is delivered as a task — poll rather than guess a delay */
  async function waitFor(pred, tries) {
    for (let i = 0; i < (tries || 80); i++) { if (pred()) return true; await tick(5); }
    return !!pred();
  }
  const settle = (n) => waitFor(() => false, n || 12);

  /* ---- stub the backend transport ----
     `/api/jobs` is what JobsBackendSync reads; `/api/ats/import` is the public
     Greenhouse + Lever import the backend performs. `atsReachable = false`
     stands in for the backend being down. */
  let backendJobs = [];
  let atsBody = null;
  let atsReachable = true;
  let atsCalls = 0;
  let ciscoBody = null;
  let ciscoReachable = true;
  let ciscoCalls = 0;
  APIClient.configure({
    transport: (url, opts) => {
      if (/\/api\/ats\/import/.test(url)) {
        atsCalls++;
        if (!atsReachable) return Promise.reject(new Error('backend unreachable'));
        return Promise.resolve({ ok: true, status: 200, data: atsBody });
      }
      if (/\/api\/cisco\/import/.test(url)) {
        ciscoCalls++;
        if (!ciscoReachable) return Promise.reject(new Error('backend unreachable'));
        return Promise.resolve({ ok: true, status: 200, data: ciscoBody });
      }
      if (/\/api\/jobs/.test(url)) return Promise.resolve({ ok: true, status: 200, data: backendJobs });
      return Promise.resolve({ ok: true, status: 200, data: {} });
    },
  });

  /* the summary POST /api/cisco/import returns (backend services/cisco_import.py) */
  function ciscoSummary(over) {
    return Object.assign({
      countries: 2,
      found: 2, saved: 2, duplicate: 0, failed: 0, filtered: 3,
      detail: [
        { country: 'Saudi Arabia', fetched: 5, found: 2, saved: 2, duplicate: 0, failed: 0, filtered: 3 },
        { country: 'Qatar', fetched: 0, found: 0, saved: 0, duplicate: 0, failed: 0, filtered: 0 },
      ],
      jobs: [
        { id: 9101, source: 'Cisco', source_job_id: 'cisco-2017334', title: 'Partner Solutions Engineer',
          company: 'Cisco', location: 'Riyadh, Saudi Arabia',
          apply_url: 'https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/Partner-Solutions-Engineer_2017334-1',
          canonical_url: 'https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/Partner-Solutions-Engineer_2017334-1',
          salary_status: 'unknown', salary: '', salary_disclosed: false, currency: 'USD' },
        { id: 9102, source: 'Cisco', source_job_id: 'cisco-2012553',
          title: 'Senior Cybersecurity Solutions Engineer - Splunk (Saudi Arabia)',
          company: 'Cisco', location: 'Riyadh, Saudi Arabia',
          apply_url: 'https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/Senior-Cybersecurity_2012553-1',
          canonical_url: 'https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/Senior-Cybersecurity_2012553-1',
          salary_status: 'unknown', salary: '', salary_disclosed: false, currency: 'USD' },
      ],
    }, over || {});
  }

  /* the summary POST /api/ats/import really returns (see backend
     app/services/ats_import.py import_all) */
  function atsSummary(over) {
    return Object.assign({
      companies: 2,
      found: 3, saved: 2, duplicate: 1, failed: 0, filtered: 5,
      imported: 2, skipped: 1,
      detail: [
        { company: 'Careem', ats: 'greenhouse', found: 2, saved: 2, duplicate: 0, failed: 0, filtered: 13, fetched: 15 },
        { company: 'Binance', ats: 'lever', found: 1, saved: 0, duplicate: 1, failed: 0, filtered: 5, fetched: 6 },
      ],
      jobs: [
        { id: 9001, source: 'Greenhouse', source_job_id: 'gh-1', title: 'Solutions Engineer',
          company: 'Careem', location: 'Dubai, United Arab Emirates',
          apply_url: 'https://boards.greenhouse.io/careem/jobs/1',
          canonical_url: 'https://boards.greenhouse.io/careem/jobs/1' },
        { id: 9002, source: 'Greenhouse', source_job_id: 'gh-2', title: 'Data Engineer',
          company: 'Careem', location: 'Dubai, United Arab Emirates',
          apply_url: 'https://boards.greenhouse.io/careem/jobs/2',
          canonical_url: 'https://boards.greenhouse.io/careem/jobs/2' },
      ],
    }, over || {});
  }

  /* a backend JobOut as the fetch run would have left it */
  function backendJob(over) {
    return Object.assign({
      id: 501, ext_id: '', source: 'LinkedIn', source_job_id: 'linkedin-4021',
      title: 'Senior Solutions Engineer', company: 'Careem', location: 'Dubai, United Arab Emirates',
      work_mode: '', employment_type: '', salary: '', salary_disclosed: false, currency: 'USD',
      description: '', skills: [], posted_date: '2026-08-02', created_at: '2026-08-02T00:00:00',
      apply_url: 'https://www.linkedin.com/jobs/view/4021/',
      canonical_url: 'https://www.linkedin.com/jobs/view/4021/',
    }, over || {});
  }

  const LI_URL = 'https://www.linkedin.com/jobs/search/?keywords=solutions%20engineer';
  const BAYT_URL = 'https://www.bayt.com/en/uae/jobs/solutions-engineer-jobs/';
  const GT_URL = 'https://www.gulftalent.com/uae/jobs/title/solutions-engineer';

  function reset() {
    JobFetchStore.clear();
    ImportedJobs.clear();
    backendJobs = [];
    atsBody = atsSummary();
    atsReachable = true;
    atsCalls = 0;
    ciscoBody = ciscoSummary();
    ciscoReachable = true;
    ciscoCalls = 0;
    JobFetch.ui.running = false;
    JobFetch.ui.token = null;
    JobFetch.ui.error = null;
    JobFetch.ui.drafts = {};
  }

  /* Both backend sources run on every fetch, so a case about ONE of them
     silences the other rather than baking the sum into its expectations. */
  function noCisco() {
    ciscoBody = ciscoSummary({ found: 0, saved: 0, duplicate: 0, failed: 0, detail: [], jobs: [] });
  }
  function noAts() {
    atsBody = atsSummary({ found: 0, saved: 0, duplicate: 0, failed: 0, detail: [], jobs: [] });
  }

  /* the exact run shape extension/fetch-jobs.js returns */
  function runResult(over) {
    return Object.assign({
      ok: true, token: 'tok-1',
      totals: { found: 4, saved: 2, duplicate: 1, failed: 1 },
      sources: [
        { id: 'LinkedIn', found: 2, saved: 2, duplicate: 0, failed: 0, status: 'ok', reason: null,
          diag: { scrollRounds: 6, cardCandidates: 25, uniqueIds: 25, parsed: 25, failedCards: 0 } },
        { id: 'Bayt', found: 1, saved: 0, duplicate: 1, failed: 0, status: 'ok', reason: null,
          diag: { scrollRounds: 0, cardCandidates: 1, uniqueIds: 1, parsed: 1, failedCards: 0 } },
        { id: 'GulfTalent', found: 1, saved: 0, duplicate: 0, failed: 1, status: 'failed', reason: 'could not save' },
      ],
      attention: [],
    }, over || {});
  }

  /* capture what the app posts to the extension bridge */
  function captureMessages() {
    const seen = [];
    const on = ev => { if (ev.source === window && ev.data && ev.data.__careerpilot === true) seen.push(ev.data); };
    window.addEventListener('message', on);
    return { seen, stop: () => window.removeEventListener('message', on) };
  }

  const CASES = [

    ['1 · One saved search URL per portal is stored and read back', () => {
      reset();
      assert(JobFetchStore.PORTALS.map(p => p.id).join(',') === 'LinkedIn,Bayt,GulfTalent', 'exactly the three portals');
      assert(JobFetchStore.setSearch('LinkedIn', LI_URL).ok, 'LinkedIn URL should save');
      assert(JobFetchStore.setSearch('Bayt', BAYT_URL).ok, 'Bayt URL should save');
      assert(JobFetchStore.setSearch('GulfTalent', GT_URL).ok, 'GulfTalent URL should save');
      assert(JobFetchStore.searchFor('Bayt') === BAYT_URL, 'the Bayt URL reads back exactly');

      /* one per portal: saving again replaces, never appends */
      JobFetchStore.setSearch('Bayt', 'https://www.bayt.com/en/saudi-arabia/jobs/architect-jobs/');
      assert(JobFetchStore.configured().length === 3, 'still three sources, got ' + JobFetchStore.configured().length);
      assert(JobFetchStore.searchFor('Bayt').indexOf('saudi-arabia') !== -1, 'the newer URL replaced the old one');
      return '3 portals · one URL each · replaced not appended';
    }],

    ['2 · A URL from the wrong portal is refused, and nothing is overwritten', () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      const bad = JobFetchStore.setSearch('LinkedIn', BAYT_URL);
      assert(!bad.ok && /LinkedIn/.test(bad.error), 'a Bayt URL in the LinkedIn slot must be refused: ' + JSON.stringify(bad));
      assert(JobFetchStore.searchFor('LinkedIn') === LI_URL, 'the previously saved URL survives a rejected edit');
      assert(!JobFetchStore.setSearch('Bayt', 'bayt.com/jobs').ok, 'a bare host without a scheme is refused');
      assert(JobFetchStore.setSearch('Bayt', '').ok && JobFetchStore.searchFor('Bayt') === '', 'clearing a URL is allowed');
      return 'wrong portal · no scheme → refused · existing value kept';
    }],

    ['3 · With no saved search configured, the extension is not called at all', async () => {
      reset();
      const cap = captureMessages();
      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);
      cap.stop();
      /* the public Greenhouse/Lever feeds still run — they need no saved search
         — but nothing is asked of the extension */
      assert(cap.seen.length === 0, 'no message may be sent when no portal is configured');
      assert(JobFetch.ui.running === false, 'the button must not be left spinning');
      return 'no portal → no extension message (the ATS feeds still run: see A4)';
    }],

    ['4 · Fetch Jobs Now sends the saved searches to the extension', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      JobFetchStore.setSearch('GulfTalent', GT_URL);
      const cap = captureMessages();
      const r = JobFetch.fetchNow();
      await waitFor(() => cap.seen.some(m => m.kind === 'fetch-jobs'));
      cap.stop();

      assert(r.ok && r.token, 'the run should start: ' + JSON.stringify(r));
      const msg = cap.seen.find(m => m.kind === 'fetch-jobs');
      assert(msg, 'a signed fetch-jobs message must be posted for the bridge');
      assert(msg.token === r.token, 'the message carries the run token');
      assert(msg.sources.length === 2, 'only configured portals are sent, got ' + msg.sources.length);
      assert(msg.sources[0].id === 'LinkedIn' && msg.sources[0].url === LI_URL, 'the LinkedIn saved search is sent verbatim');
      assert(msg.sources.every(s => Object.keys(s).sort().join(',') === 'id,url'), 'only the portal and its URL are sent');
      assert(JobFetch.ui.running === true, 'the run is marked in flight');

      await JobFetch.onResult(r.token, runResult({ token: r.token }));   // tidy up
      return 'signed message · 2 sources · token matched';
    }],

    ['5 · A finished run stores exactly four counts, and the panel shows them', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      await JobFetch.finish('tok-1', runResult());

      const run = JobFetchStore.lastRun();
      assert(run && run.ok, 'the run should be recorded');
      /* `filtered` joined the four: a job the backend rejected on purpose
         (HTTP 422) is not a failure and is counted on its own */
      assert(Object.keys(run.totals).sort().join(',') === 'duplicate,failed,filtered,found,saved',
        'the counts stored: ' + Object.keys(run.totals));
      assert(run.totals.found === 4 && run.totals.saved === 2 && run.totals.duplicate === 1 && run.totals.failed === 1,
        'counts: ' + JSON.stringify(run.totals));

      const html = JobFetchView.panel(JobFetch.ui);
      assert(/found 4/.test(html) && /saved 2/.test(html) && /duplicate 1/.test(html) && /failed 1/.test(html),
        'the counts must be on the panel');
      assert(/filtered 0/.test(html), 'including the filtered count');
      assert(/Fetch Jobs Now/.test(html), 'the button is on the panel');
      return 'found 4 · saved 2 · duplicate 1 · filtered 0 · failed 1 rendered';
    }],

    ['6 · A source needing sign-in or a CAPTCHA is shown as Needs Attention', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      await JobFetch.finish('tok-2', runResult({
        totals: { found: 1, saved: 1, duplicate: 0, failed: 0 },
        sources: [
          { id: 'LinkedIn', found: 0, saved: 0, duplicate: 0, failed: 0, status: 'needs-attention', reason: 'Sign-in required — open the saved search in Chrome and log in' },
          { id: 'Bayt', found: 1, saved: 1, duplicate: 0, failed: 0, status: 'ok', reason: null },
        ],
        attention: ['LinkedIn'],
      }));

      const run = JobFetchStore.lastRun();
      const li = run.sources.find(s => s.id === 'LinkedIn');
      assert(li.status === 'needs-attention', 'the blocked source keeps its status');
      const html = JobFetchView.panel(JobFetch.ui);
      assert(/needs attention/i.test(html), 'the panel must say Needs Attention');
      assert(/Sign-in required/.test(html), 'and say what to do about it');
      return 'per-source Needs Attention rendered';
    }],

    ['7 · Newly fetched jobs appear in Today\'s Jobs straight away', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      /* the extension has just saved these through POST /api/jobs */
      backendJobs = [
        backendJob(),
        backendJob({ id: 502, source: 'Bayt', source_job_id: 'bayt-5123456', title: 'Cloud Consultant', company: 'stc',
          location: 'Riyadh, Saudi Arabia', apply_url: 'https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/',
          canonical_url: 'https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/' }),
      ];
      assert(ImportedJobs.active().length === 0, 'the board starts empty');

      await JobFetch.finish('tok-3', runResult({ totals: { found: 2, saved: 2, duplicate: 0, failed: 0 } }));

      const urls = ImportedJobs.active().map(j => j.url);
      assert(urls.indexOf('https://www.linkedin.com/jobs/view/4021/') !== -1, 'the LinkedIn job must be on the board');
      assert(urls.indexOf('https://www.bayt.com/en/uae/jobs/cloud-consultant-5123456/') !== -1, 'the Bayt job must be on the board');
      const li = ImportedJobs.active().find(j => j.source === 'LinkedIn');
      assert(li.title === 'Senior Solutions Engineer' && li.company === 'Careem', 'the visible fields carried through');
      assert(li.status === 'new', 'a fetched job arrives as new — no decision is taken for the user');
      return '2 fetched jobs visible in Today\'s Jobs';
    }],

    ['8 · Re-fetching the same searches never duplicates a job on the board', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      backendJobs = [backendJob()];
      await JobFetch.finish('tok-4', runResult({ totals: { found: 1, saved: 1, duplicate: 0, failed: 0 } }));
      await JobFetch.finish('tok-5', runResult({ totals: { found: 1, saved: 0, duplicate: 1, failed: 0 } }));

      const copies = ImportedJobs.active().filter(j => j.url === 'https://www.linkedin.com/jobs/view/4021/');
      assert(copies.length === 1, 'exactly one copy of the job, found ' + copies.length);
      assert(JobFetchStore.lastRun().totals.duplicate === 1, 'the second run reports it as a duplicate');
      return 'idempotent · one copy · counted as duplicate';
    }],

    ['9 · Without the extension the run fails honestly and the board is untouched', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      ImportedJobs.create({ title: 'Local Role', company: 'LocalCo', url: 'https://localco.com/jobs/9', description: 'A local posting.' });

      await JobFetch.finish('tok-6', null);           // the bridge answered with nothing

      const run = JobFetchStore.lastRun();
      assert(run && run.ok === false, 'the failure is recorded, not swallowed');
      assert(/extension/i.test(run.error), 'and names the cause: ' + run.error);
      assert(ImportedJobs.active().length === 1, 'nothing on the board changed');
      assert(JobFetch.ui.running === false, 'the button is released');
      const html = JobFetchView.panel(JobFetch.ui);
      assert(/extension/i.test(html), 'the panel explains the failure');
      return 'no extension → honest failure · board untouched';
    }],

    ['10 · The extension\'s reply is accepted through the bridge relay, stale tokens are not', async () => {
      reset();
      /* this case is about the bridge relay, so keep the backend sources out
         of the totals — their own coverage is A1-A6 and C1-C5 */
      noAts(); noCisco();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      JobFetch.bind();
      const started = JobFetch.fetchNow();
      await settle();

      /* a reply from an older run must be ignored */
      window.postMessage({ __careerpilot_from_ext: true, kind: 'fetch-result', token: 'an-old-token',
        detail: runResult({ totals: { found: 99, saved: 99, duplicate: 0, failed: 0 } }) }, '*');
      await settle();
      assert(JobFetch.ui.running === true, 'a stale reply must not end the current run');

      window.postMessage({ __careerpilot_from_ext: true, kind: 'fetch-result', token: started.token,
        detail: runResult({ token: started.token, totals: { found: 3, saved: 3, duplicate: 0, failed: 0 } }) }, '*');
      await waitFor(() => JobFetch.ui.running === false);
      await settle();

      assert(JobFetch.ui.running === false, 'the matching reply ends the run');
      assert(JobFetchStore.lastRun().totals.saved === 3, 'the right run was recorded: ' + JSON.stringify(JobFetchStore.lastRun().totals));
      return 'relay accepted · stale token ignored';
    }],

    ['10b · Harvest diagnostics are kept and shown per source', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      await JobFetch.finish('tok-diag', runResult());

      const li = JobFetchStore.lastRun().sources.find(s => s.id === 'LinkedIn');
      assert(li.diag, 'the LinkedIn read diagnostics must survive');
      assert(Object.keys(li.diag).sort().join(',') === 'cardCandidates,failedCards,parsed,scrollRounds,uniqueIds',
        'exactly the five diagnostics: ' + Object.keys(li.diag));
      assert(li.diag.scrollRounds === 6 && li.diag.cardCandidates === 25 && li.diag.parsed === 25, 'values: ' + JSON.stringify(li.diag));

      const html = JobFetchView.panel(JobFetch.ui);
      assert(/6 scroll rounds/.test(html) && /25 card candidates/.test(html), 'the panel shows the read diagnostics');
      assert(/25 unique ids/.test(html) && /25 parsed/.test(html) && /0 failed/.test(html), 'all five are shown');
      /* a source that reported none must not invent them */
      const gt = JobFetchStore.lastRun().sources.find(s => s.id === 'GulfTalent');
      assert(gt.diag === null, 'no diagnostics reported → none stored');
      return 'scroll rounds · candidates · ids · parsed · failed rendered';
    }],

    ['10c · A LinkedIn harvest failure is reported as failed, never as a job found', async () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      backendJobs = [];
      /* what the extension returns when 99+ results are on screen but the
         markup changed and almost nothing could be read */
      await JobFetch.finish('tok-harvest-fail', {
        ok: true, token: 'tok-harvest-fail',
        totals: { found: 0, saved: 0, duplicate: 0, failed: 0 },
        sources: [{
          id: 'LinkedIn', found: 0, saved: 0, duplicate: 0, failed: 0,
          status: 'failed',
          reason: 'harvest failed — 25 job cards on screen but only 1 could be read (7 scroll rounds, 25 job ids seen). LinkedIn\'s results markup has probably changed.',
          diag: { scrollRounds: 7, cardCandidates: 25, uniqueIds: 25, parsed: 1, failedCards: 24 },
        }],
        attention: [],
      });

      const run = JobFetchStore.lastRun();
      const li = run.sources[0];
      assert(li.status === 'failed', 'an under-collecting harvest is a failure, not a success');
      assert(run.totals.saved === 0 && ImportedJobs.active().length === 0, 'and nothing lands on the board');
      const html = JobFetchView.panel(JobFetch.ui);
      assert(/harvest failed/.test(html), 'the panel says the harvest failed');
      assert(/25 card candidates/.test(html) && /1 parsed/.test(html) && /24 failed/.test(html),
        'and shows the numbers that prove it');
      return 'failed status · reason · diagnostics all surfaced';
    }],

    /* ---- public ATS feeds: Greenhouse + Lever ---- */

    ['A1 · Greenhouse + Lever are imported on every Fetch Jobs Now', async () => {
      reset(); noCisco();
      JobFetchStore.setSearch('Bayt', BAYT_URL);
      const started = JobFetch.fetchNow();
      await settle();
      assert(atsCalls === 1, 'the ATS import must be requested once, got ' + atsCalls);

      /* the extension answers for the portal half; the ATS half merges in */
      await JobFetch.onResult(started.token, {
        ok: true, token: started.token,
        totals: { found: 1, saved: 1, duplicate: 0, failed: 0 },
        sources: [{ id: 'Bayt', found: 1, saved: 1, duplicate: 0, failed: 0, status: 'ok', reason: null }],
        attention: [], jobs: [],
      });

      const run = JobFetchStore.lastRun();
      const t = run.totals;
      /* portal 1/1/0/0 + ats 3/2/1/0 */
      assert(t.found === 4 && t.saved === 3 && t.duplicate === 1 && t.failed === 0,
        'the two halves must add up: ' + JSON.stringify(t));

      const ids = run.sources.map(s => s.id);
      assert(ids.indexOf('Bayt') !== -1, 'the portal row survives: ' + ids.join(', '));
      assert(ids.some(i => /Careem/.test(i)) && ids.some(i => /Binance/.test(i)),
        'each ATS company gets its own row: ' + ids.join(', '));
      const careem = run.sources.find(s => /Careem/.test(s.id));
      assert(/greenhouse/.test(careem.id), 'the row names the ATS: ' + careem.id);
      assert(careem.found === 2 && careem.saved === 2, 'per-company counts: ' + JSON.stringify(careem));
      return 'portal + Greenhouse + Lever in one run · found 4 · saved 3 · duplicate 1 · failed 0';
    }],

    ['A2 · ATS jobs appear in Today\'s Jobs immediately', async () => {
      reset();
      noCisco();
      JobFetchStore.setSearch('Bayt', BAYT_URL);
      /* the page cannot GET from the backend — the run's own rows must be enough */
      backendJobs = [];
      assert(ImportedJobs.active().length === 0, 'the board starts empty');

      const started = JobFetch.fetchNow();
      await settle();
      await JobFetch.onResult(started.token, {
        ok: true, token: started.token, totals: { found: 0, saved: 0, duplicate: 0, failed: 0 },
        sources: [], attention: [], jobs: [],
      });

      const board = ImportedJobs.active();
      assert(board.length === 2, 'both imported ATS jobs must be on the board, got ' + board.length);
      const j = board.find(x => x.url === 'https://boards.greenhouse.io/careem/jobs/1');
      assert(j, 'the Greenhouse job is in the store Today\'s Jobs renders');
      assert(j.title === 'Solutions Engineer' && j.company === 'Careem', 'fields carried through');
      assert(j.location === 'Dubai, United Arab Emirates', 'GCC location kept: ' + j.location);
      assert(j.source === 'Greenhouse', 'source recorded: ' + j.source);
      assert(j.backendId === 9001, 'the backend id is kept for dedup');
      assert(j.status === 'new', 'it arrives as new — no decision taken for the user');
      assert(Imports.render().indexOf('Solutions Engineer') !== -1, 'and it renders in the Imports panel');
      return '2 ATS jobs on the board with no second request and no refresh';
    }],

    ['A3 · Re-importing the same feeds never doubles a card', async () => {
      reset(); noCisco();
      JobFetchStore.setSearch('Bayt', BAYT_URL);
      const run1 = JobFetch.fetchNow();
      await settle();
      await JobFetch.onResult(run1.token, { ok: true, token: run1.token, totals: null, sources: [], jobs: [] });
      assert(ImportedJobs.active().length === 2, 'first run puts 2 on the board');

      /* second run: the backend reports them as duplicates and returns no rows */
      atsBody = atsSummary({ found: 2, saved: 0, duplicate: 2, failed: 0, jobs: [] });
      const run2 = JobFetch.fetchNow();
      await settle();
      await JobFetch.onResult(run2.token, { ok: true, token: run2.token, totals: null, sources: [], jobs: [] });

      assert(ImportedJobs.active().length === 2, 'still exactly 2 cards, got ' + ImportedJobs.active().length);
      assert(JobFetchStore.lastRun().totals.duplicate === 2, 'and they are counted as duplicates');
      return 'idempotent across runs';
    }],

    ['A4 · ATS runs even with no saved search URLs configured', async () => {
      reset(); noCisco();
      assert(JobFetchStore.configured().length === 0, 'no portal is configured');
      const cap = captureMessages();
      const r = JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);
      cap.stop();

      assert(r.ok && r.ats, 'the run still starts for the public feeds: ' + JSON.stringify(r));
      assert(!cap.seen.some(m => m.kind === 'fetch-jobs'), 'no extension message when no portal is configured');
      assert(atsCalls === 1, 'the ATS import still ran');
      const run = JobFetchStore.lastRun();
      assert(run && run.ok, 'the run is recorded as successful: ' + JSON.stringify(run && run.error));
      assert(run.totals.found === 3 && run.totals.saved === 2, 'with the ATS counts: ' + JSON.stringify(run.totals));
      assert(ImportedJobs.active().length === 2, 'and its jobs reached the board');
      return 'no portals needed — Greenhouse + Lever stand alone';
    }],

    ['A5 · A backend that is down is reported, and never claims success', async () => {
      reset(); noCisco();
      atsReachable = false;
      const r = JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);

      const run = JobFetchStore.lastRun();
      const row = (run.sources || []).find(s => /Greenhouse \+ Lever/.test(s.id));
      assert(row, 'an honest failure row is recorded: ' + JSON.stringify(run.sources));
      assert(row.status === 'failed' && /backend is not reachable/i.test(row.reason), 'and says why: ' + row.reason);
      assert(run.totals.saved === 0 && ImportedJobs.active().length === 0, 'nothing is invented');
      return 'backend down → failed row, zero counts';
    }],

    ['A6 · The run reshapes the backend summary without inventing numbers', () => {
      const frag = JobFetch.atsFragment(atsSummary());
      assert(frag.totals.found === 3 && frag.totals.saved === 2 && frag.totals.duplicate === 1 && frag.totals.failed === 0,
        'totals come straight from the backend: ' + JSON.stringify(frag.totals));
      assert(frag.sources.length === 2 && frag.jobs.length === 2, 'one row per company, rows passed through');
      /* the region filter is surfaced, not hidden */
      assert(/13 postings outside Saudi Arabia \/ UAE \/ GCC \/ Remote/.test(frag.sources[0].reason),
        'the filtered-out count is shown: ' + frag.sources[0].reason);

      /* a company whose feed failed is marked failed, not silently ok */
      const bad = JobFetch.atsFragment(atsSummary({
        detail: [{ company: 'Broken', ats: 'lever', error: 'HTTP 404', found: 0, saved: 0, duplicate: 0, failed: 1 }],
      }));
      assert(bad.sources[0].status === 'failed' && /404/.test(bad.sources[0].reason), 'feed error surfaces');
      return 'counts passed through · filtered count shown · feed errors surfaced';
    }],

    /* ---- Cisco (careers.cisco.com) ---- */

    ['C1 · Cisco is imported on every Fetch Jobs Now, alongside the ATS feeds', async () => {
      reset();
      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);

      assert(ciscoCalls === 1, 'the Cisco import must be requested once, got ' + ciscoCalls);
      assert(atsCalls === 1, 'and the ATS import still runs, got ' + atsCalls);

      const run = JobFetchStore.lastRun();
      const ids = run.sources.map(s => s.id);
      assert(ids.some(i => /Cisco · Saudi Arabia/.test(i)), 'a row per Cisco country: ' + ids.join(', '));
      assert(ids.some(i => /Cisco · Qatar/.test(i)), 'including the empty one: ' + ids.join(', '));
      assert(ids.some(i => /Careem/.test(i)), 'the Greenhouse/Lever rows are untouched: ' + ids.join(', '));

      /* ats 3/2/1/0 + cisco 2/2/0/0 */
      const t = run.totals;
      assert(t.found === 5 && t.saved === 4 && t.duplicate === 1 && t.failed === 0,
        'both backend sources add up: ' + JSON.stringify(t));

      const sa = run.sources.find(s => /Cisco · Saudi Arabia/.test(s.id));
      assert(sa.found === 2 && sa.saved === 2, 'Saudi counts: ' + JSON.stringify(sa));
      assert(/3 postings outside the target roles/.test(sa.reason), 'filtered-out is explained: ' + sa.reason);
      return 'Cisco + Greenhouse + Lever in one run · found 5 · saved 4';
    }],

    ['C2 · Cisco jobs land in Today\'s Jobs immediately', async () => {
      reset();
      noAts();
      backendJobs = [];
      assert(ImportedJobs.active().length === 0, 'the board starts empty');

      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);

      const board = ImportedJobs.active();
      assert(board.length === 2, 'both Cisco jobs must be on the board, got ' + board.length);
      const j = board.find(x => /Partner Solutions Engineer/.test(x.title));
      assert(j, 'the Cisco job is in the store Today\'s Jobs renders');
      assert(j.company === 'Cisco' && j.source === 'Cisco', 'company/source: ' + j.company + '/' + j.source);
      assert(j.location === 'Riyadh, Saudi Arabia', 'Saudi location kept: ' + j.location);
      assert(j.backendId === 9101, 'the backend id is kept for dedup');
      assert(j.status === 'new', 'arrives as new — no decision taken for the user');
      assert(Imports.render().indexOf('Partner Solutions Engineer') !== -1, 'and it renders on the board');
      return '2 Cisco jobs on the board with no refresh';
    }],

    ['C3 · Re-running never doubles a Cisco card', async () => {
      reset();
      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);
      assert(ImportedJobs.active().filter(j => j.source === 'Cisco').length === 2, 'first run adds 2');

      /* second run: the backend reports them as duplicates and returns no rows */
      ciscoBody = ciscoSummary({ found: 2, saved: 0, duplicate: 2, jobs: [] });
      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);

      assert(ImportedJobs.active().filter(j => j.source === 'Cisco').length === 2,
        'still exactly 2 Cisco cards, got ' + ImportedJobs.active().filter(j => j.source === 'Cisco').length);
      return 'idempotent across runs';
    }],

    ['C4 · A Cisco failure is reported and never claims success', async () => {
      reset();
      ciscoReachable = false;
      JobFetch.fetchNow();
      await waitFor(() => JobFetch.ui.running === false, 200);

      const run = JobFetchStore.lastRun();
      const row = (run.sources || []).find(s => s.id === 'Cisco');
      assert(row && row.status === 'failed', 'an honest failure row: ' + JSON.stringify(run.sources));
      assert(/backend is not reachable/i.test(row.reason), 'and says why: ' + row.reason);
      /* the ATS half still counted — one source failing is not the run failing */
      assert(run.totals.saved === 2, 'the other source still saved: ' + JSON.stringify(run.totals));
      assert(!ImportedJobs.active().some(j => j.source === 'Cisco'), 'no Cisco job is invented');
      return 'Cisco down → failed row · ATS unaffected';
    }],

    ['C5 · The Cisco summary is reshaped without inventing numbers', () => {
      const frag = JobFetch.ciscoFragment(ciscoSummary());
      assert(frag.totals.found === 2 && frag.totals.saved === 2, 'totals from the backend: ' + JSON.stringify(frag.totals));
      assert(frag.sources.length === 2 && frag.jobs.length === 2, 'one row per country');
      assert(frag.sources[0].id === 'Cisco · Saudi Arabia', 'row id: ' + frag.sources[0].id);
      const err = JobFetch.ciscoFragment(ciscoSummary({
        detail: [{ country: 'Qatar', error: 'boom', found: 0, saved: 0, duplicate: 0, failed: 1 }],
      }));
      assert(err.sources[0].status === 'failed' && /boom/.test(err.sources[0].reason), 'errors surface');
      return 'counts passed through · per-country rows · errors surfaced';
    }],

    ['11 · v1 scope: the panel offers no scoring, autofill or apply controls', () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      const html = JobFetchView.panel(JobFetch.ui);
      assert(!/match score|autofill|submit application|apply now|score/i.test(html),
        'the discovery panel must not grow matching/autofill/apply controls');
      assert(!/onclick="[^"]*(Autofill|Submit|Apply)/i.test(html), 'no apply/submit handler on the panel');
      ['approve', 'apply', 'submit', 'autofill', 'score'].forEach(k =>
        assert(typeof JobFetch[k] === 'undefined', 'JobFetch must not expose ' + k + '()'));
      return 'discovery only — no matching/autofill/application surface';
    }],

    ['12 · The saved searches are the only thing persisted about a portal', () => {
      reset();
      JobFetchStore.setSearch('LinkedIn', LI_URL);
      const raw = AppStorage.get(JobFetchStore.STORAGE_KEY);
      assert(Object.keys(raw).sort().join(',') === 'lastRun,searches', 'only searches + lastRun are stored: ' + Object.keys(raw));
      assert(JSON.stringify(raw).indexOf('password') === -1 && JSON.stringify(raw).indexOf('cookie') === -1,
        'no credential of any kind is stored — the fetch uses the browser session');
      return 'searches + last run only · no credentials';
    }],
  ];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function run() {
    const results = [];
    for (const [name, fn] of CASES) {
      try { results.push({ name, pass: true, detail: (await fn()) || '' }); }
      catch (e) { results.push({ name, pass: false, detail: e.message }); }
    }
    return results;
  }

  /* the real app shares file:// localStorage with this page — snapshot and
     restore it whatever happens (CLAUDE.md §5) */
  async function guardedRun() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    let results;
    try { localStorage.clear(); results = await run(); }
    finally { localStorage.clear(); Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k])); }
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
    console.log(`Fetch jobs (app): ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await guardedRun()));
})();
