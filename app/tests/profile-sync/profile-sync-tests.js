/* ============================================================
   ProfileAutoSync — browser harness.

   The real APIClient / Backend / Migration run; only the HTTP transport is
   faked so every request is captured. localStorage is snapshotted and
   restored, so the real profile is never touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* ---- fake transport: captures calls, answers per endpoint ---- */
  const calls = [];
  let reachableFlag = true;
  let employmentStatus = 201;

  function fakeTransport(url, opts) {
    const method = opts.method;
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, url, body });
    if (/\/api\/health$/.test(url)) return Promise.resolve({ ok: reachableFlag, status: reachableFlag ? 200 : 503, data: reachableFlag ? { api_version: 'test' } : null });
    if (/\/api\/status$/.test(url)) return Promise.resolve({ ok: true, status: 200, data: {} });
    if (/\/api\/employment$/.test(url)) return Promise.resolve({ ok: employmentStatus < 400, status: employmentStatus, data: {} });
    return Promise.resolve({ ok: true, status: 200, data: {} });   // profile, preferences
  }
  APIClient.configure({ transport: fakeTransport });

  const profilePuts = () => calls.filter(c => c.method === 'PUT' && /\/api\/profile$/.test(c.url));
  const lastProfilePut = () => profilePuts().slice(-1)[0] || null;

  /* ---- write a known local profile (blank defaults + overrides) ---- */
  function writeProfile(over) {
    over = over || {};
    const p = ProfileStore.defaults();
    p.personal.firstName = over.firstName || '';
    p.personal.lastName = over.lastName || '';
    p.contact.email = over.email || '';
    p.contact.city = over.city || '';
    p.contact.country = over.country || '';
    if (over.withEmployment) {
      p.employment = p.employment || {};
      p.employment.company = 'TechVantage';
      p.employment.title = 'Solutions Engineer';
      p.employment.startDate = '2021-03';
      p.employment.current = true;
    }
    localStorage.setItem(ProfileStore.KEY, JSON.stringify(p));
  }

  function setup(o) {
    o = o || {};
    reachableFlag = (o.reachable === undefined) ? true : o.reachable;
    employmentStatus = (o.empStatus === undefined) ? 201 : o.empStatus;
    localStorage.removeItem(ProfileStore.KEY);
    ProfileAutoSync.clearFlag();
    if (o.profile) writeProfile(Object.assign({ withEmployment: !!o.withEmployment }, o.profile));
    calls.length = 0;
  }

  const REAL = { firstName: 'Alex', lastName: 'Morgan', email: 'alex.morgan@example.com', city: 'Dubai', country: 'United Arab Emirates' };

  const CASES = [

    ['1 · No non-empty local profile → skipped, nothing sent', async () => {
      setup({ profile: null });
      const r = await ProfileAutoSync.maybeSync();
      assert(r.skipped && /no non-empty/.test(r.reason), 'expected skip, got: ' + JSON.stringify(r));
      assert(calls.length === 0, 'no request should be made for an empty profile');
      return r.reason;
    }],

    ['2 · First sync → UPSERTs profile+prefs+employment (PUT, not /migrate)', async () => {
      setup({ profile: REAL, withEmployment: true });
      const r = await ProfileAutoSync.maybeSync();
      assert(r.ok && r.synced, 'should have synced: ' + JSON.stringify(r));
      const put = lastProfilePut();
      assert(put, 'no PUT /api/profile was made');
      assert(put.body.first_name === 'Alex' && put.body.email === 'alex.morgan@example.com', 'wrong profile body: ' + JSON.stringify(put.body));
      assert(calls.some(c => c.method === 'PUT' && /\/api\/preferences$/.test(c.url)), 'preferences not PUT');
      assert(calls.some(c => c.method === 'POST' && /\/api\/employment$/.test(c.url)), 'employment not POSTed');
      assert(!calls.some(c => /\/api\/migrate/.test(c.url)), 'must not use the insert-only /api/migrate');
      assert(ProfileAutoSync.loadFlag() && ProfileAutoSync.loadFlag().hash === r.hash, 'sync flag not recorded');
      return `PUT profile+prefs · POST employment · flag ${r.hash}`;
    }],

    ['3 · Unchanged profile → one-time gate skips (no network at all)', async () => {
      setup({ profile: REAL, withEmployment: true });
      await ProfileAutoSync.maybeSync();          // first sync sets the flag
      calls.length = 0;                            // watch the SECOND call
      const r = await ProfileAutoSync.maybeSync();
      assert(r.skipped && r.reason === 'already synced', 'should skip when unchanged: ' + JSON.stringify(r));
      assert(calls.length === 0, 'an unchanged profile must not hit the network');
      return 'second run made 0 requests';
    }],

    ['4 · Profile edited → re-syncs the new value', async () => {
      setup({ profile: REAL, withEmployment: true });
      await ProfileAutoSync.maybeSync();
      const firstHash = ProfileAutoSync.loadFlag().hash;
      writeProfile(Object.assign({ withEmployment: true }, REAL, { city: 'Abu Dhabi' }));   // edit
      calls.length = 0;
      const r = await ProfileAutoSync.maybeSync();
      assert(!r.skipped && r.ok, 'edit should re-sync: ' + JSON.stringify(r));
      assert(r.hash !== firstHash, 'hash should change after an edit');
      assert(lastProfilePut().body.city === 'Abu Dhabi', 'edited city not pushed');
      return 'edit propagated · hash changed';
    }],

    ['5 · Backend unreachable → skipped, flag NOT set, no profile PUT', async () => {
      setup({ profile: REAL, reachable: false });
      const r = await ProfileAutoSync.maybeSync();
      assert(r.skipped && r.reason === 'backend unreachable', 'expected unreachable skip: ' + JSON.stringify(r));
      assert(profilePuts().length === 0, 'must not PUT profile when unreachable');
      assert(ProfileAutoSync.loadFlag() === null, 'must not mark synced when it never pushed');
      return 'no push · retries safely later';
    }],

    ['6 · Employment 409 (already there) counts as synced, not an error', async () => {
      setup({ profile: REAL, withEmployment: true, empStatus: 409 });
      const r = await ProfileAutoSync.maybeSync();
      assert(r.ok, 'profile should still upsert: ' + JSON.stringify(r));
      assert(r.employment >= 1, 'a 409 employment should be counted as synced');
      assert(!r.errors.some(e => /employment/.test(e)), 'a 409 must not be reported as an error');
      return 'idempotent employment · no false error';
    }],

    ['7 · A blank/default profile is never pushed over the backend', async () => {
      /* a fresh install must not overwrite a populated backend with emptiness */
      setup({ profile: { firstName: '', lastName: '', email: '' } });
      const r = await ProfileAutoSync.maybeSync();
      assert(r.skipped && /no non-empty/.test(r.reason), 'blank profile should skip: ' + JSON.stringify(r));
      assert(profilePuts().length === 0, 'blank profile must never be PUT');
      return 'blank profile guarded';
    }],

    ['8 · PUT body is the snake_cased shape the backend + extension expect', async () => {
      setup({ profile: REAL, withEmployment: true });
      await ProfileAutoSync.maybeSync();
      const body = lastProfilePut().body;
      ['first_name', 'last_name', 'headline', 'summary', 'email', 'phone', 'city', 'country', 'links', 'authorization']
        .forEach(k => assert(k in body, 'profile body missing key: ' + k));
      return 'body matches ProfileIn / extension contract';
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
    console.log(`Profile auto-sync: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await guardedRun()));
})();
