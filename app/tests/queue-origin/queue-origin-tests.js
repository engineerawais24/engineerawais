/* ============================================================
   Browser-level test — the EXACT origin http://127.0.0.1:5500.

   Reproduces the real smoke-test environment: the CareerPilot app served at
   http://127.0.0.1:5500, route #/approvals. Proves the manifest content-script
   matches that URL, the bridge loads at this origin, and a queue-open
   postMessage forwards through the background into chrome.storage.local — the
   chain that was silently broken by the file://-only / CustomEvent bridge.

   Run it by serving the repo root at 127.0.0.1:5500 and opening
     http://127.0.0.1:5500/app/tests/queue-origin/queue-origin.html#/approvals
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const $ = id => document.getElementById(id);
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));

  const EXACT_ORIGIN = 'http://127.0.0.1:5500';
  const EXACT_APP_URL = 'http://127.0.0.1:5500/app/index.html#/approvals';
  const JB_URL = 'https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007';
  const PROFILE = { fullName: 'Alex Morgan', email: 'alex.morgan@example.com' };

  /* faithful Chrome MV3 match-pattern algorithm (host ignores port; path ignores #fragment) */
  function matchPattern(pattern, urlStr) {
    const m = pattern.match(/^(\*|https?|file|ftp):\/\/([^\/]*)(\/.*)$/);
    if (!m) return false;
    const scheme = m[1], host = m[2], path = m[3];
    let url; try { url = new URL(urlStr); } catch (e) { return false; }
    const uscheme = url.protocol.replace(':', '');
    if (scheme === '*') { if (!/^https?$/.test(uscheme)) return false; }
    else if (scheme !== uscheme) return false;
    const uhost = url.hostname.toLowerCase();
    if (host === '*') { /* any */ }
    else if (host.startsWith('*.')) {
      const base = host.slice(2).toLowerCase();
      if (uhost !== base && !uhost.endsWith('.' + base)) return false;
    } else if (uhost !== host.toLowerCase()) return false;
    const upath = url.pathname + url.search;   // fragment excluded, matching Chrome
    const rx = new RegExp('^' + path.split('*').map(s => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return rx.test(upath);
  }

  function postQueueOpen(over) {
    window.postMessage(Object.assign(
      { __careerpilot: true, kind: 'queue-open', url: JB_URL, token: 'origin-tok', jobId: 'anduril', profile: PROFILE, resume: null },
      over || {}), '*');
  }

  const CASES = [

    ['1 · running at the exact origin + route (127.0.0.1:5500 #/approvals)', () => {
      assert(location.origin === EXACT_ORIGIN, 'origin should be ' + EXACT_ORIGIN + ', got ' + location.origin +
        ' — serve the repo root at 127.0.0.1:5500');
      assert(location.hash === '#/approvals', 'load this harness with #/approvals, got ' + JSON.stringify(location.hash));
      return location.origin + location.pathname + location.hash;
    }],

    ['2 · manifest bridge content-script matches the exact app URL + localhost', async () => {
      const manifest = await (await fetch('../../../extension/manifest.json')).json();
      const entry = (manifest.content_scripts || []).find(cs => (cs.js || []).indexOf('bridge.js') !== -1);
      assert(entry, 'a content_scripts entry must load bridge.js');
      const pats = entry.matches || [];
      assert(pats.some(p => matchPattern(p, EXACT_APP_URL)), 'no pattern matches ' + EXACT_APP_URL + ' — patterns: ' + JSON.stringify(pats));
      assert(pats.some(p => matchPattern(p, 'http://localhost/app/index.html')), 'localhost must be covered');
      assert(pats.indexOf('http://127.0.0.1/*') !== -1 && pats.indexOf('http://localhost/*') !== -1, 'explicit 127.0.0.1/* and localhost/* required');
      assert(!pats.some(p => /^file:/.test(p)), 'the bridge must not rely on file://');
      return 'bridge matches 127.0.0.1:5500 + localhost · no file://';
    }],

    ['3 · the real bridge loaded at this origin (popup: Bridge loaded ✓)', () => {
      const b = window.__store.cp_bridge_status;
      assert(b && b.loaded === true, 'bridge did not record itself loaded: ' + JSON.stringify(b));
      assert(b.origin === EXACT_ORIGIN, 'loaded marker origin should be ' + EXACT_ORIGIN + ', got ' + b.origin);
      return 'cp_bridge_status.loaded=true · origin=' + b.origin;
    }],

    ['4 · queue-open postMessage → bridge forwards → background stores the intent', async () => {
      window.__sent.length = 0;
      postQueueOpen({ token: 'origin-e2e' });
      await tick();
      assert(window.__sent.length === 1, 'bridge should forward exactly one message, got ' + window.__sent.length);
      assert(window.__sent[0].type === 'cp-queue-open' && window.__sent[0].url === JB_URL, 'wrong forwarded message');
      const ev = window.__store.cp_last_queue_event;
      assert(ev && ev.url === JB_URL && ev.token === 'origin-e2e', 'cp_last_queue_event not recorded');

      const store = {};
      const res = await CPBackground.handleMessage(window.__sent[0], { set: o => { Object.assign(store, o); return Promise.resolve(); }, now: 5 });
      assert(res.ok && res.stored, 'background should store the intent: ' + JSON.stringify(res));
      assert(store[CPBackground.PENDING].url === JB_URL && store[CPBackground.PENDING].token === 'origin-e2e', 'stored intent must match');
      return 'postMessage → bridge → background → chrome.storage.local (at 127.0.0.1:5500)';
    }],

    ['5 · bridge ACKs the page (app can confirm the extension is connected)', async () => {
      let ack = null;
      const onMsg = ev => { const d = ev.data; if (d && d.__careerpilot_from_ext === true && d.kind === 'queue-open-ack') ack = d; };
      window.addEventListener('message', onMsg);
      postQueueOpen({ token: 'origin-ack' });
      await tick(40);
      window.removeEventListener('message', onMsg);
      assert(ack && ack.ok === true && ack.token === 'origin-ack', 'expected an ok ACK: ' + JSON.stringify(ack));
      return 'queue-open-ack posted back to the page';
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
    console.log(`Queue-origin (127.0.0.1:5500): ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
