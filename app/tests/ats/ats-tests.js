/* ============================================================
   CareerPilot ATS Engine v1 — browser harness.

   Pure detection tests: the engine is a side-effect-free function, so
   this suite touches NO localStorage and needs NO other module. Every
   case is a representative URL (or an embedded-HTML page) for one of the
   eight supported ATSes, plus negative cases that must stay Unknown.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* a case that expects a specific ATS at or above a confidence floor */
  function expectAts(input, ats, opts) {
    const o = opts || {};
    const r = AtsEngine.detect(input);
    assert(r.ats === ats, `expected ats "${ats}", got "${r.ats}" (conf ${r.confidence})`);
    assert(r.supported === true, `"${ats}" should be supported`);
    assert(r.confidence >= (o.minConf || 0.6),
      `confidence ${r.confidence} below floor ${o.minConf || 0.6} for ${ats}`);
    if ('company' in o) {
      assert(r.company === o.company,
        `expected company "${o.company}", got "${r.company}"`);
    }
    return r;
  }

  function expectUnknown(input) {
    const r = AtsEngine.detect(input);
    assert(r.ats === null, `expected Unknown, got "${r.ats}" (conf ${r.confidence})`);
    assert(r.supported === false, 'Unknown must not be marked supported');
    assert(r.confidence === 0, `Unknown confidence should be 0, got ${r.confidence}`);
    return r;
  }

  const CASES = [

    /* ---------- 1. Greenhouse ---------- */
    ['1 · Greenhouse — hosted board', () => {
      const r = expectAts('https://boards.greenhouse.io/stripe/jobs/4567890',
        'Greenhouse', { company: 'stripe' });
      assert(r.confidence >= 0.95, 'a hosted job page should read near-certain');
      return `${r.ats} · ${r.company} · conf ${r.confidence}`;
    }],
    ['2 · Greenhouse — job-boards host', () =>
      expectAts('https://job-boards.greenhouse.io/airbnb/jobs/6789012',
        'Greenhouse', { company: 'airbnb' }) && 'job-boards.greenhouse.io → airbnb'],
    ['2b · Greenhouse — real smoke-test job-boards URL (Anduril)', () => {
      /* the exact posting the Queue auto-apply smoke test failed on */
      const r = expectAts('https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007',
        'Greenhouse', { company: 'andurilindustries' });
      assert(r.supported && r.confidence >= 0.95, 'a real job-boards posting should read supported + near-certain');
      return `job-boards.greenhouse.io → ${r.company} · conf ${r.confidence}`;
    }],
    ['3 · Greenhouse — embed with ?for=', () =>
      expectAts('https://boards.greenhouse.io/embed/job_board?for=airtable',
        'Greenhouse', { company: 'airtable' }) && 'embed board → airtable'],
    ['4 · Greenhouse — embedded on a company site (HTML)', () => {
      const r = expectAts({
        url: 'https://www.acmecorp.com/careers/',
        html: '<div id="grnhse_app"></div>' +
              '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>',
      }, 'Greenhouse', { company: 'acme', minConf: 0.6 });
      assert(r.confidence >= 0.6 && r.confidence < 0.9,
        'a DOM-only (embedded) hit should be medium confidence, not host-certain');
      return `embedded → ${r.company} · conf ${r.confidence}`;
    }],

    /* ---------- 2. Lever ---------- */
    ['5 · Lever — posting URL', () => {
      const r = expectAts('https://jobs.lever.co/netflix/12ab34cd-5678-90ef-1234-567890abcdef',
        'Lever', { company: 'netflix' });
      assert(r.confidence >= 0.95, 'a lever posting with a job id should read near-certain');
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['6 · Lever — EU host, listing page', () =>
      expectAts('https://jobs.eu.lever.co/spotify', 'Lever', { company: 'spotify' })
      && 'jobs.eu.lever.co → spotify'],

    /* ---------- 3. Workday ---------- */
    ['7 · Workday — myworkdayjobs tenant', () => {
      const r = expectAts(
        'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA/Engineer_JR123',
        'Workday', { company: 'nvidia' });
      assert(r.confidence >= 0.95, 'a Workday job page should read near-certain');
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['8 · Workday — myworkdaysite tenant', () =>
      expectAts('https://cisco.wd1.myworkdaysite.com/en-US/CiscoCareers/job/Xyz_JR9',
        'Workday', { company: 'cisco' }) && 'myworkdaysite → cisco'],

    /* ---------- 4. SuccessFactors ---------- */
    ['9 · SuccessFactors — career link with ?company=', () => {
      const r = expectAts(
        'https://career5.successfactors.com/career?company=CompanyXY&career_job_req_id=9876',
        'SuccessFactors', { company: 'CompanyXY' });
      /* the host label "career5" is generic — the company came from the query */
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['10 · SuccessFactors — performancemanager host', () =>
      expectAts('https://performancemanager4.successfactors.com/sfcareer/jobreqcareer?jobId=1234',
        'SuccessFactors') && 'performancemanager4 → SuccessFactors'],

    /* ---------- 5. SmartRecruiters ---------- */
    ['11 · SmartRecruiters — hosted posting', () => {
      const r = expectAts('https://jobs.smartrecruiters.com/Ubisoft/744000012345678-gameplay-engineer',
        'SmartRecruiters', { company: 'Ubisoft' });
      assert(r.confidence >= 0.95, 'a hosted SR posting should read near-certain');
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['12 · SmartRecruiters — careers host', () =>
      expectAts('https://careers.smartrecruiters.com/Bosch/software', 'SmartRecruiters',
        { company: 'Bosch' }) && 'careers.smartrecruiters.com → Bosch'],

    /* ---------- 6. Taleo ---------- */
    ['13 · Taleo — company careersection', () => {
      const r = expectAts('https://ibm.taleo.net/careersection/2/jobdetail.ftl?job=98765',
        'Taleo', { company: 'ibm' });
      assert(r.confidence >= 0.95, 'a Taleo careersection page should read near-certain');
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['14 · Taleo — generic tbe host has no company', () =>
      expectAts('https://tbe.taleo.net/CH01/ats/careers/requisition.jsp?org=ACME&rid=42',
        'Taleo', { company: null }) && 'tbe.taleo.net → Taleo, company unknown'],

    /* ---------- 7. Oracle (Cloud Recruiting / ORC) ---------- */
    ['15 · Oracle — Fusion candidate-experience URL', () => {
      const r = expectAts(
        'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/preview/1234',
        'Oracle', { company: null });
      assert(r.confidence >= 0.95, 'the hcmUI candidate-experience path is definitive');
      return `Oracle ORC · conf ${r.confidence}`;
    }],
    ['16 · Oracle — path signal without the fa host', () =>
      expectAts('https://acme.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/requisitions/5',
        'Oracle', { minConf: 0.85 }) && 'hcmUI path alone → Oracle'],
    ['17 · Oracle — a plain oraclecloud URL is NOT recruiting', () =>
      expectUnknown('https://login.oraclecloud.com/oam/server/obrareq.cgi')
      && 'generic oraclecloud stays Unknown (no false positive)'],

    /* ---------- 8. iCIMS ---------- */
    ['18 · iCIMS — careers-<company> host', () => {
      const r = expectAts('https://careers-childrensnational.icims.com/jobs/12345/nurse/job',
        'iCIMS', { company: 'childrensnational' });
      assert(r.confidence >= 0.95, 'an iCIMS jobs URL should read near-certain');
      return `${r.company} · conf ${r.confidence}`;
    }],
    ['19 · iCIMS — bare company subdomain', () =>
      expectAts('https://pnc.icims.com/jobs/98765/analyst/job', 'iCIMS', { company: 'pnc' })
      && 'pnc.icims.com → pnc'],

    /* ---------- negative / robustness ---------- */
    ['20 · Non-ATS job boards stay Unknown', () => {
      expectUnknown('https://www.linkedin.com/jobs/view/3801234567/');
      expectUnknown('https://careers.google.com/jobs/results/123456789/');
      expectUnknown('https://www.indeed.com/viewjob?jk=abcdef1234567890');
      return 'LinkedIn / Google / Indeed → Unknown, supported:false';
    }],
    ['21 · Garbage & empty input never throw, never mis-detect', () => {
      [null, undefined, '', 'not a url', 'ftp://nope', 42, {}].forEach(bad => {
        const r = AtsEngine.detect(bad);
        assert(r.ats === null && r.supported === false && r.confidence === 0,
          'bad input should be a clean Unknown, got ' + JSON.stringify(r));
      });
      return 'null/empty/malformed/number/object → clean Unknown';
    }],
    ['22 · Contract shape & no unsupported leakage', () => {
      const r = AtsEngine.detect('https://boards.greenhouse.io/stripe/jobs/1');
      const keys = Object.keys(r).sort();
      assert(keys.join(',') === 'ats,company,confidence,supported',
        'the return shape must be exactly {ats, company, supported, confidence} — got ' + keys.join(','));
      assert(AtsEngine.SUPPORTED.length === 8, 'exactly eight ATSes are supported');
      ['Greenhouse', 'Lever', 'Workday', 'SuccessFactors', 'SmartRecruiters', 'Taleo', 'Oracle', 'iCIMS']
        .forEach(n => assert(AtsEngine.SUPPORTED.indexOf(n) !== -1, 'missing supported ATS: ' + n));
      return 'shape = {ats, company, supported, confidence} · 8 supported ATSes';
    }],
  ];

  function run() {
    return CASES.map(([name, fn]) => {
      try { return { name, pass: true, detail: fn() || '' }; }
      catch (e) { return { name, pass: false, detail: e.message }; }
    });
  }

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    console.log(`ATS Engine: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
