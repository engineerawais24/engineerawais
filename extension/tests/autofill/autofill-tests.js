/* ============================================================
   Universal Autofill Engine v2 — browser harness.

   Loads the REAL extension/content.js (its chrome.* is stubbed by the
   host page), builds one mock ATS application form that exercises every
   supported control, dispatches a single { type:'autofill' } message, and
   asserts the outcome. Pure DOM — no network, no backend, no localStorage.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const $ = id => document.getElementById(id);
  const selText = sel => (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) ? sel.options[sel.selectedIndex].text : '';
  const has = (arr, re) => (arr || []).some(x => re.test(String(x)));

  /* the profile the popup would hand to the engine (its own shape) */
  const PROFILE = {
    firstName: 'Alex', lastName: 'Morgan', fullName: 'Alex Morgan',
    email: 'alex.morgan@example.com', phone: '+971500000000',
    linkedin: 'https://www.linkedin.com/in/alexmorgan',
    city: 'Dubai', country: 'United Arab Emirates',
    nationality: 'Canadian', gender: 'Male', maritalStatus: 'Single',
    currentTitle: 'Solutions Engineer', currentCompany: 'TechVantage',
    yearsExperience: '7', noticePeriod: '',
    workAuthorization: 'Citizen — authorized in United Arab Emirates',
    needsSponsorship: false, willRelocate: true,
    headline: 'Cloud Solutions Engineer',
    summary: 'I build reliable cloud platforms. I care about developer experience.',
  };

  /* a synthetic default résumé (never touches disk or the network) */
  const RESUME = {
    name: 'Alex_Morgan_Resume.pdf', mime: 'application/pdf',
    dataUrl: 'data:application/pdf;base64,' + btoa('%PDF-1.4 CareerPilot test resume %%EOF'),
  };

  /* ---------- the mock application form ----------
     Each question sits in its own wrapper, as real ATS forms (Greenhouse,
     Lever, Workday) structure them — the engine reads a field's label from
     its own container, not the whole page. */
  function buildForm() {
    $('app-under-test').innerHTML = `
      <form id="appform">
        <div class="field"><label for="fn">First name</label><input id="fn" name="first_name"></div>
        <div class="field"><label for="ln">Last name</label><input id="ln" name="last_name"></div>
        <div class="field"><label for="full">Full name</label><input id="full" name="full_name" value="PREFILLED — do not touch"></div>
        <div class="field"><label for="em">Email address</label><input id="em" name="email" type="email"></div>
        <div class="field"><label for="ph">Phone number</label><input id="ph" name="phone" type="tel"></div>
        <div class="field"><label for="li">LinkedIn URL</label><input id="li" name="linkedin_url"></div>
        <div class="field"><label for="city">City</label><input id="city" name="city"></div>

        <div class="field"><label for="country">Country</label>
          <select id="country" name="country">
            <option value=""></option><option>Canada</option>
            <option>United Arab Emirates</option><option>United States</option>
          </select></div>

        <div class="field"><label for="nat">Nationality</label>
          <select id="nat" name="nationality">
            <option value=""></option><option>American</option>
            <option>British</option><option>Canadian</option>
          </select></div>

        <div class="field"><label for="marital">Marital status</label>
          <select id="marital" name="marital_status">
            <option value=""></option><option>Single</option><option>Married</option>
          </select></div>

        <div class="field"><label for="title">Current job title</label><input id="title" name="current_title"></div>
        <div class="field"><label for="employer">Current employer</label><input id="employer" name="company_name"></div>
        <div class="field"><label for="years">Years of experience</label><input id="years" name="yoe" type="number"></div>
        <div class="field"><label for="workauth">Work authorization status</label><input id="workauth" name="work_auth"></div>

        <fieldset class="field"><legend>Gender</legend>
          <label><input type="radio" name="gender" value="Male">Male</label>
          <label><input type="radio" name="gender" value="Female">Female</label>
          <label><input type="radio" name="gender" value="Prefer not to say">Prefer not to say</label>
        </fieldset>

        <fieldset class="field"><legend>Are you willing to relocate?</legend>
          <label><input type="radio" name="relocate" value="yes">Yes</label>
          <label><input type="radio" name="relocate" value="no">No</label>
        </fieldset>

        <fieldset class="field"><legend>Do you now or will you require visa sponsorship?</legend>
          <label><input type="radio" name="sponsor" value="yes">Yes</label>
          <label><input type="radio" name="sponsor" value="no">No</label>
        </fieldset>

        <div class="field"><label for="why">Why do you want to work here?</label>
          <textarea id="why" name="why_company"></textarea></div>
        <div class="field"><label for="challenge">Describe a challenge you overcame</label>
          <textarea id="challenge" name="challenge"></textarea></div>
        <div class="field"><label for="fav">Favorite programming language</label><input id="fav" name="fav_lang"></div>

        <div class="field"><label for="salcur">Current salary expectation (AED)</label><input id="salcur" name="current_salary" type="number"></div>
        <div class="field"><label for="salexp">Expected salary</label><input id="salexp" name="expected_salary" type="number"></div>

        <div class="field"><label><input type="checkbox" id="cbAuth">I confirm I am authorized to work in this country</label></div>
        <div class="field"><label><input type="checkbox" id="cbConsent">I agree to the Terms of Service and Privacy Policy</label></div>
        <div class="field"><label><input type="checkbox" id="cbMkt">Send me marketing emails and job alerts</label></div>
        <div class="field"><label><input type="checkbox" id="cbUnk">I have a valid driver's license</label></div>
        <div class="field"><label><input type="checkbox" id="cbPre" checked>I am willing to relocate for this role</label></div>

        <div class="field"><label for="cv">Upload your résumé (PDF or DOCX)</label>
          <input id="cv" name="resume" type="file" accept=".pdf,.docx"></div>
        <div class="field"><label for="cover">Cover letter (optional)</label>
          <input id="cover" name="cover_letter" type="file" accept=".pdf,.docx"></div>

        <button type="submit">Submit application</button>
      </form>`;

    /* a submit here would flip this flag — the engine must never trip it */
    window.__submitted = false;
    $('appform').addEventListener('submit', e => { window.__submitted = true; e.preventDefault(); });
  }

  /* run the engine once, then assert against the resulting DOM + response */
  let RES = null;
  function fire() {
    buildForm();
    window.__cpListener({ type: 'autofill', profile: PROFILE, resume: RESUME }, {}, r => { RES = r; });
    assert(RES && Array.isArray(RES.filled), 'engine returned no result');
  }

  const CASES = [
    ['1 · Text inputs', () => {
      assert($('fn').value === 'Alex', 'first name');
      assert($('ln').value === 'Morgan', 'last name');
      assert($('city').value === 'Dubai', 'city');
      assert($('title').value === 'Solutions Engineer', 'current title');
      assert($('employer').value === 'TechVantage', 'current employer');
      return 'first/last/city/title/employer filled';
    }],
    ['2 · Email input', () => {
      assert($('em').value === PROFILE.email, 'email not filled'); return $('em').value;
    }],
    ['3 · Phone input (tel)', () => {
      assert($('ph').value === PROFILE.phone, 'phone not filled'); return $('ph').value;
    }],
    ['4 · Number input (years of experience)', () => {
      assert($('years').value === '7', 'years not filled as number'); return 'years = 7';
    }],
    ['5 · Textarea (essay filled, unknown surfaced)', () => {
      assert($('why').value.trim().length > 0, 'why-textarea left empty');
      assert(!/\d{3,}/.test($('why').value), 'essay leaked a numeric/salary-looking value');
      assert($('challenge').value === '', 'unknown textarea should not be filled');
      assert(has(RES.unknown, /challenge/i), 'unknown textarea not surfaced');
      return 'essay filled · unrelated textarea surfaced';
    }],
    ['6 · Select dropdowns', () => {
      assert(selText($('country')) === 'United Arab Emirates', 'country select');
      assert(selText($('nat')) === 'Canadian', 'nationality select');
      assert(selText($('marital')) === 'Single', 'marital select');
      return 'country/nationality/marital selected';
    }],
    ['7 · Radio buttons', () => {
      const g = document.querySelector('input[name=gender]:checked');
      const r = document.querySelector('input[name=relocate]:checked');
      const s = document.querySelector('input[name=sponsor]:checked');
      assert(g && g.value === 'Male', 'gender radio');
      assert(r && r.value === 'yes', 'relocate radio (willRelocate=true → Yes)');
      assert(s && s.value === 'no', 'sponsorship radio (needsSponsorship=false → No)');
      return 'gender=Male · relocate=Yes · sponsor=No';
    }],
    ['8 · Checkbox — affirmative ticked', () => {
      assert($('cbAuth').checked === true, 'work-authorization checkbox not ticked');
      return 'authorized-to-work checkbox ticked';
    }],
    ['9 · Checkbox — consent/marketing NEVER ticked, surfaced', () => {
      assert($('cbConsent').checked === false, 'consent checkbox was auto-ticked');
      assert($('cbMkt').checked === false, 'marketing checkbox was auto-ticked');
      assert(has(RES.unknown, /agree|terms|privacy/i), 'consent not surfaced');
      assert(has(RES.unknown, /marketing/i), 'marketing not surfaced');
      return 'consent & marketing left unticked and surfaced';
    }],
    ['10 · Checkbox — unknown surfaced, prefilled untouched', () => {
      assert($('cbUnk').checked === false, 'unknown checkbox was ticked');
      assert(has(RES.unknown, /driver/i), 'unknown checkbox not surfaced');
      assert($('cbPre').checked === true, 'pre-checked box must stay checked (no overwrite)');
      return 'unknown surfaced · pre-checked box untouched';
    }],
    ['11 · LinkedIn URL', () => {
      assert($('li').value === PROFILE.linkedin, 'linkedin not filled'); return $('li').value;
    }],
    ['12 · Nationality / city / country / gender / marital', () => {
      assert(selText($('nat')) === 'Canadian', 'nationality');
      assert($('city').value === 'Dubai', 'city');
      assert(selText($('country')) === 'United Arab Emirates', 'country');
      assert(document.querySelector('input[name=gender]:checked').value === 'Male', 'gender');
      assert(selText($('marital')) === 'Single', 'marital status');
      return 'all identity fields filled';
    }],
    ['13 · Work authorization & sponsorship', () => {
      assert($('workauth').value === PROFILE.workAuthorization, 'work authorization text');
      assert($('cbAuth').checked === true, 'work-auth checkbox');
      assert(document.querySelector('input[name=sponsor]:checked').value === 'no', 'sponsorship');
      return 'work authorization filled · sponsorship = No';
    }],
    ['14 · Résumé upload (default résumé attached)', () => {
      const cv = $('cv');
      assert(cv.files && cv.files.length === 1, 'résumé file not attached');
      assert(cv.files[0].name === RESUME.name, 'wrong résumé file name');
      assert(cv.files[0].type === 'application/pdf', 'wrong résumé mime');
      assert($('cover').files.length === 0, 'cover-letter input must NOT be filled');
      assert(has(RES.filled, /resume/i), 'résumé not reported as filled');
      return `attached ${cv.files[0].name} · cover letter untouched`;
    }],
    ['15 · Salary is NEVER filled', () => {
      assert($('salcur').value === '', 'current salary was filled');
      assert($('salexp').value === '', 'expected salary was filled');
      assert(!has(RES.filled, /salary|compensation|pay/i), 'salary reported as filled');
      return 'current & expected salary left empty';
    }],
    ['16 · Never overwrite an existing answer', () => {
      assert($('full').value === 'PREFILLED — do not touch', 'a pre-filled field was overwritten');
      assert(RES.skipped >= 2, 'skipped count should include the prefilled text + checkbox');
      return `prefilled field & checkbox preserved · skipped ${RES.skipped}`;
    }],
    ['17 · Unknown questions surfaced for the user', () => {
      assert(has(RES.unknown, /favorite programming language/i), 'unknown text question not surfaced');
      assert(RES.unknown.length >= 4, 'expected several unanswered questions');
      return `${RES.unknown.length} questions marked "needs your answer"`;
    }],
    ['18 · Nothing is ever submitted', () => {
      assert(window.__submitted === false, 'the form was submitted');
      return 'no submit fired — engine only fills, never sends';
    }],
    ['19 · Reports filled fields to the popup', () => {
      assert(RES.filled.length >= 12, 'too few fields reported filled: ' + RES.filled.length);
      ['First name', 'Email', 'Phone', 'Resume'].forEach(k =>
        assert(RES.filled.indexOf(k) !== -1, 'missing filled key: ' + k));
      return `filled ${RES.filled.length} fields`;
    }],
  ];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    console.log(`Autofill v2: ${passed}/${results.length} passed`);
  }

  function run() {
    let fired = false;
    return CASES.map(([name, fn]) => {
      try {
        if (!fired) { fire(); fired = true; }   // one autofill pass, asserted many ways
        return { name, pass: true, detail: fn() || '' };
      } catch (e) { return { name, pass: false, detail: e.message }; }
    });
  }

  window.addEventListener('load', () => render(run()));
})();
