/* ============================================================
   Queue → ATS Auto Autofill v1 — browser harness for AutoApply.

   Real AutoApply + AtsEngine + content.js autofill. Storage is an in-memory
   fake; waitForForm is injected (no timers). The mock ATS page is built into
   an off-screen container in the real document (content.js autofill always
   works on the real document).
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const $ = id => document.getElementById(id);
  const container = () => $('container');
  const setForm = html => { container().innerHTML = html; };

  function memStore(init) {
    const m = Object.assign({}, init || {});
    return {
      get: k => Promise.resolve(k in m ? m[k] : null),
      set: (k, v) => { if (v === null || v === undefined) delete m[k]; else m[k] = v; return Promise.resolve({ ok: true }); },
      _map: m,
    };
  }

  const GH_URL = 'https://boards.greenhouse.io/acme/jobs/12345';
  function loc(url) { let h = ''; try { h = new URL(url).hostname; } catch (e) {} return { href: url, hostname: h }; }
  function pending(over) { return Object.assign({ url: GH_URL, token: 't-' + Math.random().toString(36).slice(2, 8), jobId: 'j1', ts: Date.now() }, over || {}); }
  function profile() {
    return {
      fullName: 'Alex Morgan', firstName: 'Alex', lastName: 'Morgan',
      email: 'alex.morgan@example.com', phone: '+971500000000', city: 'Dubai', country: 'United Arab Emirates',
      linkedin: 'https://www.linkedin.com/in/alexmorgan', headline: 'Cloud Engineer', summary: 'I build reliable clouds.',
      currentTitle: 'Engineer', currentCompany: 'Co', yearsExperience: '7', nationality: 'Canadian',
      gender: 'Male', maritalStatus: 'Single', workAuthorization: 'Citizen', needsSponsorship: false, willRelocate: true,
    };
  }
  const RESUME = { name: 'cv.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + btoa('%PDF-1.4 x') };
  const APP_FORM =
    '<div class="field"><label for="fn">First name</label><input id="fn" name="first_name"></div>' +
    '<div class="field"><label for="em">Email</label><input id="em" name="email" type="email"></div>' +
    '<div class="field"><label for="sal">Current salary</label><input id="sal" name="salary" type="number"></div>';
  const yes = () => Promise.resolve(true);
  const no = () => Promise.resolve(false);

  const CASES = [

    ['1 · No queue intent → does nothing (manual button unaffected)', async () => {
      setForm(APP_FORM);
      const st = memStore({ [AutoApply.DATA_KEY]: { profile: profile(), resume: RESUME } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, waitForForm: yes });
      assert(!r.ran && r.reason === 'not-queue-opened', 'should not run: ' + JSON.stringify(r));
      assert($('fn').value === '', 'a page opened by hand must not be auto-filled');
      return 'no intent → no autofill';
    }],

    ['2 · Stale or mismatched intent → does nothing', async () => {
      setForm(APP_FORM);
      let st = memStore({ [AutoApply.PENDING_KEY]: pending({ ts: Date.now() - 10 * 60 * 1000 }), [AutoApply.DATA_KEY]: { profile: profile() } });
      let r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, waitForForm: yes });
      assert(!r.ran, 'stale intent must not run');
      st = memStore({ [AutoApply.PENDING_KEY]: pending({ url: 'https://jobs.lever.co/other/1' }), [AutoApply.DATA_KEY]: { profile: profile() } });
      r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, waitForForm: yes });
      assert(!r.ran, 'a different job URL must not run');
      assert($('fn').value === '', 'nothing filled');
      return 'stale + wrong-URL intents ignored';
    }],

    ['3 · Happy path → detects ATS, autofills once, salary NOT filled', async () => {
      setForm(APP_FORM);
      const p = pending();
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile(), resume: RESUME } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert(r.ats === 'Greenhouse', 'ATS should be detected via AtsEngine, got ' + r.ats);
      assert($('fn').value === 'Alex', 'first name not filled');
      assert($('em').value === 'alex.morgan@example.com', 'email not filled');
      assert($('sal').value === '', 'salary must NEVER be filled');
      assert((await st.get(AutoApply.PENDING_KEY)) === null, 'intent should be consumed');
      const done = await st.get(AutoApply.DONE_KEY); assert(done && done[p.token], 'done-token not recorded');
      const res = await st.get(AutoApply.RESULT_KEY); assert(res && res.token === p.token, 'result not stored');
      return `Greenhouse · filled name+email · salary blank · intent consumed`;
    }],

    ['4 · Run-once: refresh / re-fired intent never autofills twice', async () => {
      setForm(APP_FORM);
      const p = pending();
      let calls = 0;
      const spy = () => { calls++; return { filled: ['x'], skipped: 0, unknown: [] }; };
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      let r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: spy, waitForForm: yes });
      assert(r.ran && calls === 1, 'first run should autofill once');
      r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: spy, waitForForm: yes });   // refresh
      assert(!r.ran && r.reason === 'not-queue-opened' && calls === 1, 'refresh must not autofill again');
      await st.set(AutoApply.PENDING_KEY, p);                                                                       // intent somehow re-appears
      r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: spy, waitForForm: yes });
      assert(!r.ran && r.reason === 'already-done' && calls === 1, 'done-token must block a re-fired intent');
      return 'exactly one autofill across refresh + re-fire';
    }],

    ['5 · Login wall → does nothing, surfaces Needs Attention', async () => {
      setForm('<div class="field"><label for="em2">Email</label><input id="em2" type="email"></div>' +
              '<div class="field"><label for="pw">Password</label><input id="pw" type="password"></div>' +
              '<p>Please sign in to your account to continue.</p>');
      let calls = 0; const spy = () => { calls++; return { filled: [] }; };
      const p = pending();
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: spy, waitForForm: yes });
      assert(!r.ran && r.reason === 'login' && r.attention, 'login should surface attention: ' + JSON.stringify(r));
      assert(calls === 0, 'must not autofill a login page');
      const attn = await st.get(AutoApply.ATTN_KEY); assert(attn && attn.reason === 'login' && attn.token === p.token, 'needs-attention not written');
      return 'login → attention (login) · no autofill';
    }],

    ['6 · CAPTCHA → Needs Attention', async () => {
      setForm('<div class="g-recaptcha" data-sitekey="abc"></div><div class="field"><label>Email</label><input type="email"></div>');
      let calls = 0;
      const st = memStore({ [AutoApply.PENDING_KEY]: pending(), [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: () => { calls++; }, waitForForm: yes });
      assert(!r.ran && r.reason === 'captcha' && calls === 0, 'captcha should block: ' + JSON.stringify(r));
      return 'captcha → attention · no autofill';
    }],

    ['7 · Blocked / bot wall → Needs Attention', async () => {
      setForm('<h2>Access to this page has been denied</h2>');
      const st = memStore({ [AutoApply.PENDING_KEY]: pending(), [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: () => { throw 'no'; }, waitForForm: yes });
      assert(!r.ran && r.reason === 'blocked', 'blocked page should surface attention: ' + JSON.stringify(r));
      return 'blocked → attention';
    }],

    ['8 · No application form (never appears) → Needs Attention', async () => {
      setForm('<p>Loading the posting…</p>');
      const st = memStore({ [AutoApply.PENDING_KEY]: pending(), [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: () => { throw 'no'; }, waitForForm: no });
      assert(!r.ran && r.reason === 'no-form' && r.attention, 'no form should surface attention: ' + JSON.stringify(r));
      return 'no form → attention (no-form)';
    }],

    ['9 · Empty profile → Needs Attention (nothing invented)', async () => {
      setForm(APP_FORM);
      const st = memStore({ [AutoApply.PENDING_KEY]: pending(), [AutoApply.DATA_KEY]: { profile: { fullName: '', email: '' } } });
      const r = await AutoApply.run({ loc: loc(GH_URL), doc: document, storage: st, autofill: () => { throw 'no'; }, waitForForm: yes });
      assert(!r.ran && r.reason === 'no-profile', 'empty profile should not autofill: ' + JSON.stringify(r));
      return 'no profile → attention';
    }],

    ['10 · Pure detectors: form / blocker / intent matching', () => {
      setForm('<input><input>'); assert(AutoApply.hasApplicationForm(document), '2 fields → a form');
      setForm('<input>'); assert(!AutoApply.hasApplicationForm(document), '1 field → not a form');
      setForm('<input type="file">'); assert(AutoApply.hasApplicationForm(document), 'a résumé upload → a form');
      setForm('<p>welcome to the role</p>'); assert(AutoApply.detectBlocker(document, loc(GH_URL)) === null, 'plain page → no blocker');
      setForm('<div class="g-recaptcha"></div>'); assert(AutoApply.detectBlocker(document, loc(GH_URL)) === 'captcha', 'recaptcha → captcha');
      const now = Date.now();
      assert(AutoApply.matchIntent({ url: GH_URL, token: 't', ts: now }, loc(GH_URL), now, 60000), 'exact url should match');
      assert(!AutoApply.matchIntent({ url: GH_URL, token: 't', ts: now - 1e9 }, loc(GH_URL), now, 60000), 'stale should not match');
      assert(!AutoApply.matchIntent(null, loc(GH_URL), now, 60000), 'no intent should not match');
      assert(!AutoApply.matchIntent({ url: 'https://jobs.lever.co/x/1', token: 't', ts: now }, loc(GH_URL), now, 60000), 'different host should not match');
      return 'form/blocker/intent detectors correct';
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

  function render(results) {
    const passed = results.filter(r => r.pass).length;
    const head = $('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    $('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Auto Autofill: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => { setForm(''); render(await run()); });
})();
