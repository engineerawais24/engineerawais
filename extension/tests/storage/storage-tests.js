/* ============================================================
   SafeStorage — browser harness.

   Loads the real extension/storage.js and swaps window.chrome to simulate
   every availability state. The original window.chrome is restored at the
   end. No localStorage is used, so nothing on disk is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* a fully working fake chrome.storage.local backed by a plain object */
  function chromeWithStorage() {
    const data = {};
    const c = {
      runtime: { lastError: null },
      storage: {
        local: {
          get(key, cb) { const out = {}; if (key in data) out[key] = data[key]; cb(out); },
          set(obj, cb) { Object.assign(data, obj); if (cb) cb(); },
          remove(key, cb) { delete data[key]; if (cb) cb(); },
        },
      },
    };
    c.__data = data;
    return c;
  }

  /* a fake whose get() reports a runtime.lastError, as chrome does on failure */
  function chromeWithError() {
    const c = { runtime: { lastError: null }, storage: { local: null } };
    c.storage.local = {
      get(key, cb) { c.runtime.lastError = { message: 'simulated failure' }; cb({ [key]: 'ignore-me' }); c.runtime.lastError = null; },
      set(obj, cb) { if (cb) cb(); },
      remove(key, cb) { if (cb) cb(); },
    };
    return c;
  }

  const CASES = [

    ['1 · Storage available → round-trips through chrome.storage.local', async () => {
      const c = chromeWithStorage();
      window.chrome = c;
      assert(SafeStorage.available() === true, 'available() should be true');
      const r = await SafeStorage.set('k_avail', { name: 'resume.pdf', size: 10 });
      assert(r.ok && r.persisted === true, 'set should report persisted');
      assert(eq(c.__data.k_avail, { name: 'resume.pdf', size: 10 }), 'value not written to chrome.storage.local');
      const got = await SafeStorage.get('k_avail');
      assert(eq(got, { name: 'resume.pdf', size: 10 }), 'get did not return the stored value');
      return 'set → chrome.storage.local → get round-trips · persisted:true';
    }],

    ['2 · remove() clears the value when storage is available', async () => {
      const c = chromeWithStorage();
      window.chrome = c;
      await SafeStorage.set('k_rm', { a: 1 });
      const r = await SafeStorage.remove('k_rm');
      assert(r.ok && r.persisted === true, 'remove should report persisted');
      assert(!('k_rm' in c.__data), 'value not removed from chrome.storage.local');
      assert((await SafeStorage.get('k_rm')) === null, 'get after remove should be null');
      return 'removed from storage · get → null';
    }],

    ['3 · Storage unavailable (no "storage" permission) → no throw, memory fallback', async () => {
      window.chrome = { runtime: {} };                // chrome exists, chrome.storage does NOT
      assert(SafeStorage.available() === false, 'available() should be false without storage');
      /* the exact original crash was here — this must NOT throw */
      const r = await SafeStorage.set('k_nostore', { name: 'cv.pdf' });
      assert(r.ok === true && r.persisted === false, 'set should succeed in-memory but not persist');
      const got = await SafeStorage.get('k_nostore');
      assert(eq(got, { name: 'cv.pdf' }), 'in-memory fallback did not return the value');
      return 'no throw · kept in session memory · persisted:false';
    }],

    ['4 · Reported crash is gone: reading chrome.storage.local guards cleanly', async () => {
      window.chrome = { runtime: {} };                // chrome.storage is undefined
      /* directly confirm the environment that produced the bug */
      assert(typeof window.chrome.storage === 'undefined', 'precondition: chrome.storage is undefined');
      let threw = false, val;
      try { val = await SafeStorage.get('k_missing'); } catch (e) { threw = true; }
      assert(!threw, "SafeStorage.get threw — the 'reading local' crash is not fixed");
      assert(val === null, 'a missing key should resolve to null');
      return "no 'Cannot read properties of undefined (reading local)' · resolves null";
    }],

    ['5 · chrome entirely undefined → still no throw', async () => {
      window.chrome = undefined;
      assert(SafeStorage.available() === false, 'available() should be false when chrome is undefined');
      const r = await SafeStorage.set('k_noChrome', { x: 1 });
      assert(r.ok === true && r.persisted === false, 'set should fall back to memory');
      assert(eq(await SafeStorage.get('k_noChrome'), { x: 1 }), 'memory fallback failed');
      assert((await SafeStorage.get('k_never')) === null, 'unknown key should be null');
      return 'undefined chrome tolerated · memory fallback works';
    }],

    ['6 · runtime.lastError during get → graceful fallback, no throw', async () => {
      window.chrome = chromeWithError();
      let threw = false, val;
      try { val = await SafeStorage.get('k_err'); } catch (e) { threw = true; }
      assert(!threw, 'a lastError must not throw');
      assert(val === null, 'on lastError with nothing in memory, get should resolve null');
      return 'lastError read and handled · falls back cleanly';
    }],

    ['7 · Fallback data never leaks to website localStorage', async () => {
      window.chrome = { runtime: {} };                // force the in-memory path
      const before = localStorage.length;
      await SafeStorage.set('k_leak', { secret: 'value' });
      assert(localStorage.length === before, 'SafeStorage must not write to page localStorage');
      assert(localStorage.getItem('k_leak') === null, 'value leaked into website localStorage');
      return 'in-memory only · localStorage untouched';
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
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    document.getElementById('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`SafeStorage: ${passed}/${results.length} passed`);
  }

  const originalChrome = window.chrome;
  window.addEventListener('load', async () => {
    let results;
    try { results = await run(); }
    finally { window.chrome = originalChrome; }        // never leave chrome mangled
    render(results);
  });
})();
