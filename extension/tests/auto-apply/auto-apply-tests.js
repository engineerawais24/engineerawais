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
  /* the real smoke-test job: Greenhouse's current hosted-board host is
     job-boards.greenhouse.io; the Job Board API still hands out the old
     boards.greenhouse.io URL, and Greenhouse 301-redirects between them. */
  const JB_URL       = 'https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007';
  const JB_OLD_BOARD = 'https://boards.greenhouse.io/andurilindustries/jobs/5193775007';
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
  /* the real replacement case: an old DOCX baked into a stale queue intent vs the
     current PDF the user set as the default (cp_default_resume) */
  const STALE_DOCX = { name: 'Mohammad_Awais_Senior_Technical_Consultant.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataUrl: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + btoa('OLD-DOCX') };
  const CURRENT_PDF = { name: 'Mohammad_Awais_JNCIS_2026.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + btoa('%PDF-1.4 JNCIS') };
  const APP_FORM =
    '<div class="field"><label for="fn">First name</label><input id="fn" name="first_name"></div>' +
    '<div class="field"><label for="em">Email</label><input id="em" name="email" type="email"></div>' +
    '<div class="field"><label for="sal">Current salary</label><input id="sal" name="salary" type="number"></div>';
  const yes = () => Promise.resolve(true);
  const no = () => Promise.resolve(false);

  const CASES = [

    ['1 · No queue intent → does nothing (manual button unaffected)', async () => {
      setForm(APP_FORM);
      const st = memStore({ [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
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
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
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

    /* ---- regression: the real Greenhouse job-boards.greenhouse.io smoke test ---- */

    ['11 · Queue-opened job-boards.greenhouse.io (exact Anduril URL) autofills once', async () => {
      setForm(APP_FORM);
      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(r.ran, 'should run on job-boards.greenhouse.io: ' + JSON.stringify(r));
      assert(r.ats === 'Greenhouse', 'ATS should be Greenhouse, got ' + r.ats);
      assert($('fn').value === 'Alex' && $('em').value === 'alex.morgan@example.com', 'name+email filled');
      assert($('sal').value === '', 'salary must NEVER be filled');
      assert((await st.get(AutoApply.PENDING_KEY)) === null, 'intent consumed once');
      return 'job-boards.greenhouse.io → autofilled once · salary blank';
    }],

    ['12 · boards.greenhouse.io intent → job-boards.greenhouse.io tab (301) still autofills', async () => {
      /* the exact bug: the queue stored the API url (boards.*), Greenhouse
         redirected the opened tab to job-boards.* → the form must still fill. */
      setForm(APP_FORM);
      const p = pending({ url: JB_OLD_BOARD, jobId: 'anduril' });      // what the queue opened
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });  // where it landed
      assert(r.ran && r.reason === undefined, 'redirect must not strand the intent: ' + JSON.stringify(r));
      assert($('fn').value === 'Alex', 'first name filled after the boards→job-boards redirect');
      assert($('sal').value === '', 'salary still never filled');
      return 'boards→job-boards redirect no longer strands the queue intent';
    }],

    ['13 · matchIntent: boards ⇄ job-boards equivalence, other hosts still rejected', () => {
      const now = Date.now();
      const mk = url => ({ url, token: 't', ts: now });
      assert(AutoApply.matchIntent(mk(JB_OLD_BOARD), loc(JB_URL), now, 60000), 'boards intent → job-boards tab matches');
      assert(AutoApply.matchIntent(mk(JB_URL), loc(JB_OLD_BOARD), now, 60000), 'job-boards intent → boards tab matches');
      assert(AutoApply.matchIntent(mk(JB_URL), loc(JB_URL), now, 60000), 'exact job-boards url matches');
      assert(!AutoApply.matchIntent(mk('https://job-boards.lever.co/x/1'), loc(JB_URL), now, 60000), 'a different ATS must not match');
      assert(!AutoApply.matchIntent(mk(JB_URL), loc('https://jobs.workday.com/x'), now, 60000), 'greenhouse intent must not match a non-greenhouse tab');
      return 'greenhouse boards/job-boards fold to one host; non-greenhouse hosts unaffected';
    }],

    ['14 · Manual "Autofill Application" still fills a Greenhouse form (salary blank)', () => {
      /* the manual popup path calls window.__cpHelper.autofill directly, with no
         queue intent — it must keep working and obey the same salary rule. */
      setForm(APP_FORM);
      const res = window.__cpHelper.autofill(profile(), RESUME);
      assert($('fn').value === 'Alex' && $('em').value === 'alex.morgan@example.com', 'manual fill populates name+email');
      assert($('sal').value === '', 'manual fill never touches salary');
      assert(res && res.filled && res.filled.indexOf('First name') !== -1, 'result reports filled fields');
      return 'manual autofill unchanged · name+email filled · salary blank';
    }],

    /* ---- regression: the popup's live diagnostic status ---- */

    ['15 · Diagnostic status reaches "autofill-completed" on the queue-opened job-boards page', async () => {
      setForm(APP_FORM);
      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(r.ran, 'should run');
      const status = await st.get(AutoApply.STATUS_KEY);
      assert(status && status.stage === AutoApply.STAGE.COMPLETED, 'status stage should be autofill-completed: ' + JSON.stringify(status));
      assert(status.ats === 'Greenhouse', 'status should record the ATS');
      assert(status.filled >= 2, 'status should report filled count (name+email at least), got ' + status.filled);
      return 'status: Greenhouse · autofill-completed · ' + status.filled + ' filled';
    }],

    ['16 · Hand-opened Greenhouse page → status "no-intent", nothing filled', async () => {
      setForm(APP_FORM);
      const st = memStore({ [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });   // NO pending intent
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(!r.ran && r.reason === 'not-queue-opened', 'hand-opened must not auto-run');
      assert($('fn').value === '', 'nothing may be filled on a hand-opened page');
      const status = await st.get(AutoApply.STATUS_KEY);
      assert(status && status.stage === AutoApply.STAGE.NO_INTENT, 'status stage should be no-intent: ' + JSON.stringify(status));
      assert(status.ats === 'Greenhouse', 'no-intent diagnostic still detects the ATS for the popup');
      return 'status: no-intent (Greenhouse detected) · nothing filled';
    }],

    ['17 · Login wall → status "needs-attention" (reason login)', async () => {
      setForm('<div class="field"><label for="pw2">Password</label><input id="pw2" type="password"></div>' +
              '<p>Please sign in to your account to continue.</p>');
      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, autofill: () => { throw 'no'; }, waitForForm: yes });
      assert(!r.ran && r.reason === 'login', 'login should surface attention');
      const status = await st.get(AutoApply.STATUS_KEY);
      assert(status && status.stage === AutoApply.STAGE.ATTENTION && status.reason === 'login',
        'status stage should be needs-attention/login: ' + JSON.stringify(status));
      return 'status: needs-attention · login';
    }],

    /* ---- regression: résumé upload on the real Greenhouse job (hidden native
       file input behind the "Attach" control) ---- */

    ['18 · Greenhouse hidden résumé input (exact Anduril URL) is attached behind "Attach"', async () => {
      const GH = '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field"><label for="em">Email *</label><input id="em" name="email" type="email"></div>' +
        '<div class="field"><label for="sal">Desired Salary</label><input id="sal" name="salary"></div>' +
        '<div class="field"><label for="gh_resume">Resume/CV *</label>' +
          '<div class="upload"><button type="button">Attach</button>' +
          '<input id="gh_resume" name="job_application[resume]" type="file" accept=".pdf,.doc,.docx" style="display:none">' +
          '<span id="gh_fname"></span></div></div>' +
        '<div class="field"><label for="gh_cover">Cover Letter</label>' +
          '<input id="gh_cover" name="job_application[cover_letter]" type="file" style="display:none"></div>' +
        '<div class="field"><label for="gh_photo">Profile Photo</label>' +
          '<input id="gh_photo" name="photo" type="file" accept="image/*" style="display:none"></div>';
      setForm(GH);
      /* mimic Greenhouse rendering the chosen filename on the change event */
      $('gh_resume').addEventListener('change', function () { $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : ''; });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('gh_resume').files && $('gh_resume').files.length === 1, 'the hidden résumé input must receive the file');
      assert($('gh_resume').files[0].name === RESUME.name, 'attached file should be the résumé, got ' + ($('gh_resume').files[0] || {}).name);
      assert($('gh_fname').textContent === RESUME.name, 'the filename must appear on the page (change event fired)');
      assert($('gh_cover').files.length === 0, 'cover-letter input must NOT be touched');
      assert($('gh_photo').files.length === 0, 'photo input must NOT be touched');
      assert($('sal').value === '', 'salary must never be filled');
      assert(r.result.filled.indexOf('Resume') !== -1, 'result should report the résumé attached');
      return 'hidden Greenhouse résumé attached · cover/photo untouched · filename shown · salary blank';
    }],

    ['19 · Résumé loads from chrome.storage.local (cp_default_resume) when the payload has none', async () => {
      setForm('<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field"><label for="gh_resume">Resume/CV *</label>' +
        '<input id="gh_resume" name="job_application[resume]" type="file" accept=".pdf" style="display:none"><span id="gh_fname"></span></div>');
      $('gh_resume').addEventListener('change', function () { $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : ''; });
      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({
        [AutoApply.PENDING_KEY]: p,
        [AutoApply.DATA_KEY]: { profile: profile() },     // NO résumé in the Queue payload
        [AutoApply.RESUME_KEY]: RESUME,                   // default résumé saved via the popup
      });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('gh_resume').files.length === 1 && $('gh_resume').files[0].name === RESUME.name, 'default résumé from chrome.storage.local must be attached');
      return 'cp_default_resume fallback attached';
    }],

    ['20 · No default résumé anywhere → Needs Attention (no-resume), text still filled', async () => {
      setForm('<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field"><label for="em">Email *</label><input id="em" name="email" type="email"></div>' +
        '<div class="field"><label for="gh_resume">Resume/CV *</label>' +
        '<input id="gh_resume" name="job_application[resume]" type="file" style="display:none"></div>');
      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });   // no résumé anywhere
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });
      assert(!r.ran && r.reason === 'no-resume' && r.attention, 'no résumé should surface Needs Attention: ' + JSON.stringify(r));
      assert($('fn').value === 'Alex', 'text fields are still filled before flagging');
      assert($('gh_resume').files.length === 0, 'no file attached when none exists');
      const status = await st.get(AutoApply.STATUS_KEY);
      assert(status && status.stage === AutoApply.STAGE.ATTENTION && status.reason === 'no-resume', 'status needs-attention/no-resume: ' + JSON.stringify(status));
      return 'no résumé → Needs Attention (no-resume) · text still filled';
    }],

    ['21 · Greenhouse lazy résumé input (rendered only after "Attach") is revealed, attached + diagnostics', async () => {
      setForm(
        '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field" id="rf"><label>Resume/CV *</label>' +
          '<div class="upload"><button type="button" id="attachBtn">Attach</button><span id="gh_fname"></span></div></div>' +
        '<div class="field" id="cf"><label>Cover Letter</label>' +
          '<div class="upload"><button type="button" id="coverBtn">Attach</button></div></div>');
      /* Greenhouse renders the native <input type=file> only when Attach is clicked */
      $('attachBtn').addEventListener('click', function () {
        if (document.getElementById('gh_resume')) return;
        const inp = document.createElement('input');
        inp.type = 'file'; inp.id = 'gh_resume'; inp.name = 'job_application[resume]'; inp.accept = '.pdf,.doc,.docx';
        inp.style.display = 'none';
        inp.addEventListener('change', function () { $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : ''; });
        document.getElementById('rf').querySelector('.upload').appendChild(inp);
      });
      let coverClicked = false;
      $('coverBtn').addEventListener('click', () => { coverClicked = true; });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, resumeOpts: { pollInterval: 5, pollTries: 30 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      const cv = document.getElementById('gh_resume');
      assert(cv, 'the résumé input must be revealed by clicking Attach');
      assert(cv.files && cv.files.length === 1 && cv.files[0].name === RESUME.name, 'the revealed input must receive the résumé File');
      assert($('gh_fname').textContent === RESUME.name, 'the filename must become visible on the page');
      assert(coverClicked === false, 'the cover-letter Attach must NEVER be clicked');
      const diag = await st.get(AutoApply.RESUME_DIAG_KEY);
      assert(diag && diag.resumeFound && diag.resumeInputFound && diag.fileAssigned && diag.filenameConfirmed,
        'résumé diagnostics must record found/input/assigned/filename: ' + JSON.stringify(diag));
      return 'lazy résumé revealed via Attach · attached · filename shown · cover untouched · diagnostics ✓';
    }],

    ['22 · Attach re-renders + clears the form → text AND résumé end filled (no wipe, no overwrite)', async () => {
      setForm(
        '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field"><label for="ln">Last Name *</label><input id="ln" name="last_name"></div>' +
        '<div class="field"><label for="em">Email *</label><input id="em" name="email" type="email"></div>' +
        '<div class="field" id="rf"><label>Resume/CV *</label>' +
          '<div class="upload"><button type="button" id="attachBtn">Attach</button><span id="gh_fname"></span></div></div>' +
        '<div class="field" id="cf"><label>Cover Letter</label>' +
          '<div class="upload"><button type="button" id="coverBtn">Attach</button></div></div>');

      /* the user had already typed their email by hand — it must be preserved */
      $('em').value = 'manual@user.com';

      /* clicking Attach makes Greenhouse re-render: it WIPES the text inputs
         (except the untouched email) and renders the native résumé input */
      $('attachBtn').addEventListener('click', function () {
        if (document.getElementById('gh_resume')) return;
        $('fn').value = ''; $('ln').value = '';            // the destructive re-render
        const inp = document.createElement('input');
        inp.type = 'file'; inp.id = 'gh_resume'; inp.name = 'job_application[resume]'; inp.accept = '.pdf,.doc,.docx';
        inp.style.display = 'none';
        inp.addEventListener('change', function () { $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : ''; });
        document.getElementById('rf').querySelector('.upload').appendChild(inp);
      });
      let coverClicked = false;
      $('coverBtn').addEventListener('click', () => { coverClicked = true; });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: RESUME });
      const r = await AutoApply.run({
        loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes,
        resumeOpts: { pollInterval: 5, pollTries: 30 }, stableOpts: { quiet: 10, timeout: 300 },
      });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      /* text survives the attach-triggered re-render (filled AFTER it) */
      assert($('fn').value === 'Alex' && $('ln').value === 'Morgan', 'first/last name must be (re)filled after the re-render, got fn=' + JSON.stringify($('fn').value) + ' ln=' + JSON.stringify($('ln').value));
      /* the hand-typed email is never overwritten */
      assert($('em').value === 'manual@user.com', 'a manually entered field must NEVER be overwritten, got ' + JSON.stringify($('em').value));
      /* résumé is attached simultaneously, and it is the stored PDF (not switched to DOCX) */
      const cv = document.getElementById('gh_resume');
      assert(cv && cv.files.length === 1, 'résumé must be attached alongside the text');
      assert(cv.files[0].name === RESUME.name && /pdf/i.test(cv.files[0].type), 'the stored PDF must be preserved (no silent DOCX switch): ' + cv.files[0].name + ' / ' + cv.files[0].type);
      assert($('gh_fname').textContent === RESUME.name, 'filename visible on the page');
      assert(coverClicked === false, 'cover-letter Attach never clicked');
      return 'text + résumé filled together after re-render · manual email preserved · PDF kept';
    }],

    /* ---- source of truth: cp_default_resume, never a stale queue-intent copy ---- */

    ['23 · Stale DOCX in the queue intent is IGNORED — the current cp_default_resume PDF is used', async () => {
      setForm(
        '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field" id="rf"><label>Resume/CV *</label>' +
          '<div class="upload"><input id="gh_resume" name="job_application[resume]" type="file" accept=".pdf,.docx" style="display:none"><span id="gh_fname"></span></div></div>');
      $('gh_resume').addEventListener('change', function () { $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : ''; });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({
        [AutoApply.PENDING_KEY]: p,
        [AutoApply.DATA_KEY]: { profile: profile(), resume: STALE_DOCX },   // stale résumé baked into the old intent
        [AutoApply.RESUME_KEY]: CURRENT_PDF,                               // the default the user just set in the popup
      });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      const cv = document.getElementById('gh_resume');
      assert(cv.files.length === 1, 'a résumé must be attached');
      assert(cv.files[0].name === CURRENT_PDF.name, 'the CURRENT PDF must be used, not the stale DOCX — got ' + cv.files[0].name);
      assert(!/\.docx$/i.test(cv.files[0].name) && /pdf/i.test(cv.files[0].type), 'the stale DOCX must never be attached');
      assert($('gh_fname').textContent === CURRENT_PDF.name, 'the current PDF filename is shown');
      const diag = await st.get(AutoApply.RESUME_DIAG_KEY);
      assert(diag && diag.name === CURRENT_PDF.name && diag.ok === true, 'diagnostics reflect the current PDF: ' + JSON.stringify(diag));
      return 'stale DOCX ignored · current cp_default_resume PDF attached';
    }],

    ['24 · Greenhouse widget error (uploadFile) → Needs Attention, text kept, no false green', async () => {
      setForm(
        '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field"><label for="em">Email *</label><input id="em" name="email" type="email"></div>' +
        '<div class="field" id="rf"><label>Resume/CV *</label>' +
          '<div class="upload"><input id="gh_resume" name="job_application[resume]" type="file" accept=".pdf" style="display:none">' +
          '<span id="gh_fname"></span><div id="gh_err" role="alert"></div></div></div>');
      /* Greenhouse shows the filename BUT its uploader throws — the error renders */
      $('gh_resume').addEventListener('change', function () {
        $('gh_fname').textContent = (this.files && this.files[0]) ? this.files[0].name : '';
        $('gh_err').textContent = "Cannot read properties of undefined (reading 'uploadFile')";
      });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: CURRENT_PDF });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes });

      assert(!r.ran && r.reason === 'resume-upload-failed' && r.attention, 'a widget upload error must surface Needs Attention: ' + JSON.stringify(r));
      assert($('fn').value === 'Alex' && $('em').value === 'alex.morgan@example.com', 'text fields must remain filled');
      assert((r.result ? (r.result.filled || []) : []).indexOf('Resume') === -1, 'the résumé must NOT be reported as filled');
      const diag = await st.get(AutoApply.RESUME_DIAG_KEY);
      assert(diag && diag.ok === false, 'diagnostics must NOT show success (no false green): ' + JSON.stringify(diag));
      assert(diag.uploadError && /cannot read|uploadfile/i.test(diag.uploadError), 'the upload error must be recorded: ' + JSON.stringify(diag.uploadError));
      const status = await st.get(AutoApply.STATUS_KEY);
      assert(status && status.stage === AutoApply.STAGE.ATTENTION && status.reason === 'resume-upload-failed', 'status = needs-attention/resume-upload-failed');
      return 'uploadFile error → Needs Attention · text kept · diag.ok=false · error recorded';
    }],

    /* ---- Greenhouse Resume Uploader v1: native rejected → dropzone drop ---- */

    ['25 · Native input rejected → Greenhouse DROPZONE drop succeeds (method=dropzone)', async () => {
      setForm(
        '<div class="field"><label for="fn">First Name *</label><input id="fn" name="first_name"></div>' +
        '<div class="field" id="rf"><label>Resume/CV *</label>' +
          '<div class="dropzone" id="dz">' +
            '<input id="gh_resume" name="job_application[resume]" type="file" accept=".pdf" style="display:none">' +
            '<span id="gh_fname"></span><div id="gh_err" role="alert"></div></div></div>' +
        '<div class="field" id="cf"><label>Cover Letter</label>' +
          '<div class="dropzone"><input id="gh_cover" name="job_application[cover_letter]" type="file" style="display:none"></div></div>');

      /* the NATIVE input.files assignment is rejected — the widget throws */
      $('gh_resume').addEventListener('change', function () {
        $('gh_err').textContent = "Cannot read properties of undefined (reading 'uploadFile')";
      });
      /* but Greenhouse's DROPZONE accepts a real drop: reads dataTransfer, shows
         the filename, clears the error (its true success state) */
      $('dz').addEventListener('drop', function (ev) {
        const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
        if (f) { $('gh_fname').textContent = f.name; $('gh_err').textContent = ''; }
      });
      let coverDrop = false;
      document.querySelector('#cf .dropzone').addEventListener('drop', () => { coverDrop = true; });

      const p = pending({ url: JB_URL, jobId: 'anduril' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() }, [AutoApply.RESUME_KEY]: CURRENT_PDF });
      const r = await AutoApply.run({ loc: loc(JB_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, resumeOpts: { dropInterval: 5, dropTries: 20 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('gh_fname').textContent === CURRENT_PDF.name, 'the dropzone must show the current PDF filename, got ' + JSON.stringify($('gh_fname').textContent));
      assert($('gh_err').textContent === '', 'the upload error must be cleared once the dropzone accepts the file');
      assert($('fn').value === 'Alex', 'text fields must be filled');
      assert(coverDrop === false, 'the cover-letter dropzone must NEVER receive a drop');
      const diag = await st.get(AutoApply.RESUME_DIAG_KEY);
      assert(diag && diag.ok === true && diag.method === 'dropzone', 'diagnostics: uploaded via dropzone: ' + JSON.stringify(diag));
      assert(r.result.filled.indexOf('Resume') !== -1, 'résumé must be reported as filled');
      return 'native rejected → dropzone drop accepted · filename shown · cover untouched · method=dropzone';
    }],

    /* ---- Workday Adapter v1 ---- */

    ['26 · Workday: fills the visible current step (data-automation-id fields), salary blank, hidden step untouched', async () => {
      const WD_URL = 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Remote/Engineer_JR1/apply';
      setForm(
        '<div data-automation-id="legalNameSection">' +
          '<label for="wfn">First Name</label><input id="wfn" data-automation-id="legalNameSection_firstName">' +
          '<label for="wln">Last Name</label><input id="wln" data-automation-id="legalNameSection_lastName"></div>' +
        '<div><label for="wem">Email Address</label><input id="wem" type="email" data-automation-id="email"></div>' +
        '<div><label for="wph">Phone Number</label><input id="wph" type="tel" data-automation-id="phone-number"></div>' +
        '<div><label for="wcity">City</label><input id="wcity" data-automation-id="addressSection_city"></div>' +
        '<div><label for="wcountry">Country</label><select id="wcountry" data-automation-id="country"><option value=""></option><option>Canada</option><option>United Arab Emirates</option></select></div>' +
        '<div><label for="wexp">Years of Experience</label><input id="wexp" type="number" data-automation-id="yearsExperience"></div>' +
        '<div><label for="wli">LinkedIn Profile</label><input id="wli" data-automation-id="linkedinQuestion"></div>' +
        '<div><label for="wsal">Desired Salary</label><input id="wsal" type="number" data-automation-id="salary"></div>' +
        /* a later step present in the DOM but hidden — Workday shows one step at a time */
        '<div style="display:none"><label for="wnext">First Name</label><input id="wnext" data-automation-id="review_firstName"></div>');

      const p = pending({ url: WD_URL, jobId: 'wd1' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(WD_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 10, timeout: 200 } });

      assert(r.ran, 'should run on Workday: ' + JSON.stringify(r));
      assert(r.ats === 'Workday', 'ATS should be Workday, got ' + r.ats);
      assert($('wfn').value === 'Alex' && $('wln').value === 'Morgan', 'first/last name filled');
      assert($('wem').value === 'alex.morgan@example.com', 'email filled');
      assert($('wph').value === '+971500000000', 'phone filled');
      assert($('wcity').value === 'Dubai', 'city filled');
      assert($('wcountry').value === 'United Arab Emirates', 'country select filled');
      assert($('wexp').value === '7', 'years of experience filled');
      assert($('wli').value === profile().linkedin, 'linkedin filled');
      assert($('wsal').value === '', 'salary must NEVER be filled');
      assert($('wnext').value === '', 'a hidden (non-current) step must NOT be filled');
      return 'Workday current step filled (name/email/phone/city/country/experience/linkedin) · salary blank · hidden step untouched';
    }],

    ['27 · Workday duplicate-run prevention: SPA re-render / re-fire never autofills twice', async () => {
      const WD_URL = 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/City/Analyst_JR9/apply';
      setForm('<div><label for="wfn2">First Name</label><input id="wfn2" data-automation-id="firstName"></div>' +
              '<div><label for="wem2">Email</label><input id="wem2" type="email" data-automation-id="email"></div>');
      let calls = 0;
      const spy = () => { calls++; return { filled: ['First name', 'Email'], skipped: 0, unknown: [] }; };
      const p = pending({ url: WD_URL, jobId: 'wd2' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      const opt = { loc: loc(WD_URL), doc: document, storage: st, autofill: spy, waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } };

      let r = await AutoApply.run(opt);
      assert(r.ran && calls === 1, 'first run autofills once: ' + JSON.stringify(r) + ' calls=' + calls);
      r = await AutoApply.run(opt);                                            // SPA re-render fires run() again
      assert(!r.ran && r.reason === 'not-queue-opened' && calls === 1, 'a re-fire must not autofill again (intent consumed): ' + JSON.stringify(r));
      await st.set(AutoApply.PENDING_KEY, p);                                  // intent somehow reappears
      r = await AutoApply.run(opt);
      assert(!r.ran && r.reason === 'already-done' && calls === 1, 'the done-token blocks a re-fired intent: ' + JSON.stringify(r));
      return 'Workday: exactly one autofill across SPA re-renders / re-fires';
    }],

    ['28 · Workday modal → application SPA transition (PwC wd3): intent survives, fills the real form once', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD';
      /* start on the "Start Your Application" chooser — NOT the form */
      setForm('<h2>Start Your Application</h2>' +
              '<button type="button" data-automation-id="autofillWithResume">Autofill with Resume</button>' +
              '<button type="button" data-automation-id="applyManually">Apply Manually</button>');
      assert(!AutoApply.workdayFormReady(document), 'precondition: the chooser is NOT a ready form');

      const p = pending({ url: PWC_URL, jobId: 'pwc1' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });

      /* the user clicks Apply Manually → the real "My Information" step renders
         shortly. Fields use GENERIC input data-automation-ids + a wrapper <label>
         WITHOUT `for` — exactly the shape that made only the phone (type=tel) fill. */
      setTimeout(() => {
        setForm('<div data-automation-id="formField-firstName"><label>First Name</label><div><input id="wfn" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-lastName"><label>Last Name</label><div><input id="wln" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-email"><label>Email Address</label><div><input id="wem" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-phone"><label>Phone Number</label><div><input id="wph" type="tel" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-city"><label>City</label><div><input id="wcity" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-linkedin"><label>LinkedIn Profile</label><div><input id="wli" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-salary"><label>Desired Salary</label><div><input id="wsal" type="number" data-automation-id="textInputBox"></div></div>');
      }, 40);

      /* use the REAL waitForForm (not injected) to exercise the modal→form wait */
      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), formInterval: 10, formTimeout: 5000, stableOpts: { quiet: 10, timeout: 200 } });

      assert(r.ran && r.ats === 'Workday', 'should run on the real Workday form after the modal: ' + JSON.stringify(r));
      assert($('wfn').value === 'Alex' && $('wln').value === 'Morgan', 'first/last name filled via wrapper label (generic input id)');
      assert($('wem').value === 'alex.morgan@example.com', 'email filled');
      assert($('wph').value === '+971500000000', 'phone filled');
      assert($('wcity').value === 'Dubai', 'city filled');
      assert($('wli').value === profile().linkedin, 'linkedin filled');
      assert($('wsal').value === '', 'salary must NEVER be filled');
      const doneRec = await st.get(AutoApply.DONE_KEY);
      assert(doneRec && doneRec[p.token], 'the intent is consumed only AFTER the real form appears');
      return 'modal → Apply Manually → real form filled once (wrapper labels) · salary blank · intent survived the transition';
    }],

    ['29 · Workday country combobox: EXACT profile match is selected', async () => {
      const WD_URL = 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/City/A_JR/apply';
      setForm('<div data-automation-id="formField-country"><label>Country</label>' +
                '<button id="cbtn" aria-haspopup="listbox" data-automation-id="countryDropdown">Select One</button>' +
                '<div id="clist"></div></div>');
      const OPTIONS = ['Canada', 'United Arab Emirates', 'United Kingdom'];
      $('cbtn').addEventListener('click', function () {
        const list = $('clist');
        if (list.childNodes.length) return;
        OPTIONS.forEach(name => {
          const o = document.createElement('div');
          o.setAttribute('role', 'option'); o.textContent = name;
          o.addEventListener('click', () => { $('cbtn').textContent = name; });
          list.appendChild(o);
        });
      });

      const p = pending({ url: WD_URL, jobId: 'wdc' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });   // country = 'United Arab Emirates'
      const r = await AutoApply.run({ loc: loc(WD_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('cbtn').textContent === 'United Arab Emirates', 'the exact profile country must be selected, got ' + JSON.stringify($('cbtn').textContent));
      return 'Workday country combobox filled by EXACT match';
    }],

    ['30 · Workday combobox: NO exact match → never guessed, left unset', async () => {
      const WD_URL = 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/City/B_JR/apply';
      setForm('<div data-automation-id="formField-country"><label>Country</label>' +
                '<button id="cbtn2" aria-haspopup="listbox" data-automation-id="countryDropdown">Select One</button>' +
                '<div id="clist2"></div></div>');
      const OPTIONS = ['United Kingdom', 'United States'];   // profile country "United Arab Emirates" has NO exact match here
      $('cbtn2').addEventListener('click', function () {
        const list = $('clist2');
        if (list.childNodes.length) return;
        OPTIONS.forEach(name => {
          const o = document.createElement('div');
          o.setAttribute('role', 'option'); o.textContent = name;
          o.addEventListener('click', () => { $('cbtn2').textContent = name; });
          list.appendChild(o);
        });
      });

      const p = pending({ url: WD_URL, jobId: 'wdc2' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      const r = await AutoApply.run({ loc: loc(WD_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('cbtn2').textContent === 'Select One', 'a non-exact match must NEVER be guessed, got ' + JSON.stringify($('cbtn2').textContent));
      return 'no exact combobox match → left unset (never guessed)';
    }],

    ['31 · Workday PwC (wd3): Latin Given/Family name filled, Arabic Given/Family name left EMPTY', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD';
      setForm(
        '<div data-automation-id="formField-latinGivenName"><label>Latin Given Name(s)</label><div><input id="lgn" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-latinFamilyName"><label>Latin Family Name</label><div><input id="lfn" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-arabicGivenName"><label>Arabic Given Name(s)</label><div><input id="agn" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-arabicFamilyName"><label>Arabic Family Name</label><div><input id="afn" data-automation-id="textInputBox"></div></div>' +
        /* also a field labelled in Arabic script — must stay empty too */
        '<div data-automation-id="formField-scriptName"><label>الاسم الأول</label><div><input id="scr" data-automation-id="textInputBox"></div></div>');

      const p = pending({ url: PWC_URL, jobId: 'pwc-ar' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });   // profile has Latin names only
      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('lgn').value === 'Alex', 'Latin Given Name must be filled with the Latin first name, got ' + JSON.stringify($('lgn').value));
      assert($('lfn').value === 'Morgan', 'Latin Family Name must be filled with the Latin last name, got ' + JSON.stringify($('lfn').value));
      assert($('agn').value === '', 'Arabic Given Name must stay EMPTY (no Arabic name stored), got ' + JSON.stringify($('agn').value));
      assert($('afn').value === '', 'Arabic Family Name must stay EMPTY, got ' + JSON.stringify($('afn').value));
      assert($('scr').value === '', 'an Arabic-script-labelled name field must stay EMPTY, got ' + JSON.stringify($('scr').value));
      return 'Latin names filled · Arabic (word + script) name fields left empty';
    }],

    ['32 · Workday login/verification does NOT consume the intent (kept alive)', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD/apply/applyManually';
      setForm('<h2>Sign In to your account</h2>' +
              '<input id="li_em" type="email" placeholder="Email"><input id="li_pw" type="password" placeholder="Password">' +
              '<p>Please verify your email to continue.</p>');
      const p = pending({ url: PWC_URL, jobId: 'pwc-login' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      /* real waitForForm, short cap → the form never appears within this page */
      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), formInterval: 10, formTimeout: 150, stableOpts: { quiet: 5, timeout: 50 } });

      assert(!r.ran && r.reason === 'workday-waiting' && r.kept, 'a login page → waiting, not consumed: ' + JSON.stringify(r));
      assert((await st.get(AutoApply.PENDING_KEY)) !== null, 'the queue intent must remain ALIVE during login');
      const doneRec = (await st.get(AutoApply.DONE_KEY)) || {};
      assert(!doneRec[p.token], 'the intent must NOT be marked done on a login page');
      assert($('li_pw').value === '', 'nothing filled on the login page');
      return 'Workday login → intent kept alive, not consumed, nothing filled';
    }],

    ['33 · Workday login → real form: intent survives login, autofills once when the form appears', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD/apply/applyManually';
      setForm('<h2>Sign In</h2><input type="email"><input type="password"><p>verify your email</p>');
      const p = pending({ url: PWC_URL, jobId: 'pwc-lf' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: profile() } });
      /* the user signs in → the "My Information" form renders shortly after */
      setTimeout(() => {
        setForm('<div data-automation-id="formField-legalName--firstName"><label>Latin Given Name(s)</label><div><input id="f1" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-legalName--lastName"><label>Latin Family Name</label><div><input id="f2" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-email"><label>Email Address</label><div><input id="f3" data-automation-id="textInputBox"></div></div>' +
                '<div data-automation-id="formField-phone"><label>Phone Number</label><div><input id="f4" type="tel" data-automation-id="textInputBox"></div></div>');
      }, 50);

      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), formInterval: 10, formTimeout: 5000, stableOpts: { quiet: 10, timeout: 200 } });
      assert(r.ran && r.ats === 'Workday', 'should autofill the real form after login: ' + JSON.stringify(r));
      assert($('f1').value === 'Alex' && $('f2').value === 'Morgan' && $('f3').value === 'alex.morgan@example.com', 'name+email filled after login');
      const doneRec = await st.get(AutoApply.DONE_KEY);
      assert(doneRec && doneRec[p.token], 'the intent is consumed only AFTER the form appears (not during login)');
      return 'login → form → filled once · intent survived login';
    }],

    ['34 · Workday intent valid ≥30 min; a non-Workday intent still expires at 3 min', async () => {
      const now = Date.now();
      const TEN_MIN = 10 * 60 * 1000;
      const WD = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD/apply';
      setForm('<div><label for="wa">First Name</label><input id="wa" data-automation-id="firstName"></div>' +
              '<div><label for="wb">Email</label><input id="wb" type="email" data-automation-id="email"></div>');
      let st = memStore({ [AutoApply.PENDING_KEY]: { url: WD, token: 'tw', jobId: 'j', ts: now - TEN_MIN }, [AutoApply.DATA_KEY]: { profile: profile() } });
      let r = await AutoApply.run({ loc: loc(WD), doc: document, storage: st, now, waitForForm: yes, stableOpts: { quiet: 5, timeout: 50 } });
      assert(r.ran, 'a 10-min-old intent must STILL run on Workday: ' + JSON.stringify(r));

      const GH = 'https://boards.greenhouse.io/acme/jobs/1';
      st = memStore({ [AutoApply.PENDING_KEY]: { url: GH, token: 'tg', jobId: 'j', ts: now - TEN_MIN }, [AutoApply.DATA_KEY]: { profile: profile() } });
      r = await AutoApply.run({ loc: loc(GH), doc: document, storage: st, now, waitForForm: yes });
      assert(!r.ran && r.reason === 'not-queue-opened', 'a 10-min-old intent must EXPIRE on non-Workday: ' + JSON.stringify(r));
      return 'Workday intent valid ≥30 min · non-Workday expires at 3 min';
    }],

    ['35 · Workday phone: separate +966 code field → national number, extension untouched, Mobile only on exact', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD/apply/applyManually';
      setForm(
        '<div data-automation-id="formField-countryPhoneCode"><label>Country Phone Code</label>' +
          '<button id="wpc" aria-haspopup="listbox" data-automation-id="countryPhoneCode">Saudi Arabia (+966)</button></div>' +
        '<div data-automation-id="formField-phoneNumber"><label>Phone Number</label><div><input id="wpn" type="tel" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-phoneExtension"><label>Phone Extension</label><div><input id="wpx" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-phoneType"><label>Phone Device Type</label>' +
          '<button id="wpt" aria-haspopup="listbox" data-automation-id="phoneType">Select One</button><div id="wptlist"></div></div>');
      const OPTIONS = ['Landline', 'Mobile', 'Pager'];
      $('wpt').addEventListener('click', function () {
        const list = $('wptlist');
        if (list.childNodes.length) return;
        OPTIONS.forEach(name => {
          const o = document.createElement('div');
          o.setAttribute('role', 'option'); o.textContent = name;
          o.addEventListener('click', () => { $('wpt').textContent = name; });
          list.appendChild(o);
        });
      });

      const prof = Object.assign(profile(), { phone: '+966536886174' });   // no extension stored
      const p = pending({ url: PWC_URL, jobId: 'pwc-phone' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: prof } });
      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } });

      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('wpn').value === '536886174', 'Phone Number must be the national number 536886174, got ' + JSON.stringify($('wpn').value));
      assert($('wpx').value === '', 'Phone Extension must NOT be filled, got ' + JSON.stringify($('wpx').value));
      assert(/\+?966/.test($('wpc').textContent) && !/536886174/.test($('wpc').textContent), 'the country-code field must keep +966 and never receive the number');
      assert($('wpt').textContent === 'Mobile', 'Phone Device Type must select the EXACT "Mobile" option, got ' + JSON.stringify($('wpt').textContent));
      return 'national number 536886174 · extension untouched · code field kept +966 · Mobile selected (exact)';
    }],

    ['36 · Workday CUSTOM "Country / Territory Phone Code" combobox (+966) → Phone Number 536886174 (queue + manual, never overwrite)', async () => {
      const PWC_URL = 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/Athens/Data-Security-Engineer_747045WD/apply/applyManually';
      /* the code control is a CUSTOM combobox (button + nested selected value),
         labelled "Country / Territory Phone Code" — NOT a native input/select */
      setForm(
        '<div data-automation-id="formField-country/territoryPhoneCode"><label>Country / Territory Phone Code</label>' +
          '<div><button id="wpc2" data-automation-id="phoneWidgetCountryPhoneCode" aria-haspopup="listbox">' +
          '<span data-automation-id="selectedItem">Saudi Arabia (+966)</span></button></div></div>' +
        '<div data-automation-id="formField-phoneNumber"><label>Phone Number</label><div><input id="wpn2" type="tel" data-automation-id="textInputBox"></div></div>' +
        '<div data-automation-id="formField-phoneExtension"><label>Phone Extension</label><div><input id="wpx2" data-automation-id="textInputBox"></div></div>');
      const prof = Object.assign(profile(), { phone: '+966536886174' });

      /* queue auto-autofill */
      const p = pending({ url: PWC_URL, jobId: 'pwc-ph2' });
      const st = memStore({ [AutoApply.PENDING_KEY]: p, [AutoApply.DATA_KEY]: { profile: prof } });
      const r = await AutoApply.run({ loc: loc(PWC_URL), doc: document, storage: st, now: Date.now(), waitForForm: yes, stableOpts: { quiet: 5, timeout: 100 } });
      assert(r.ran, 'should run: ' + JSON.stringify(r));
      assert($('wpn2').value === '536886174', 'queue: Phone Number must be the national number, got ' + JSON.stringify($('wpn2').value));
      assert($('wpx2').value === '', 'Phone Extension must stay empty');
      assert(!/536886174/.test($('wpc2').textContent) && /\+966/.test($('wpc2').textContent), 'the custom code control keeps +966 and never receives the number');

      /* manual "Autofill Application" uses the SAME normalization */
      $('wpn2').value = '';
      window.__cpHelper.autofill(prof, null);
      assert($('wpn2').value === '536886174', 'manual autofill must also produce the national number, got ' + JSON.stringify($('wpn2').value));

      /* never overwrite a genuine user-entered phone value */
      $('wpn2').value = '0500000000';
      window.__cpHelper.autofill(prof, null);
      assert($('wpn2').value === '0500000000', 'a user-entered phone value must NEVER be overwritten, got ' + JSON.stringify($('wpn2').value));
      return 'custom code combobox detected · national number (queue + manual) · code kept · user value preserved';
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
