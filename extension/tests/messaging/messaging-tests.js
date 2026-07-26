/* ============================================================
   Queue → ATS messaging — background.js + bridge.js.

   The reliable replacement for the old file:// / CustomEvent bridge: the
   CareerPilot app (localhost) does window.postMessage; bridge.js forwards it as
   a runtime message; background.js stores the one-shot intent. Real modules,
   stubbed chrome (see messaging.html — window.__store / window.__sent).
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const $ = id => document.getElementById(id);
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));   // let postMessage deliver

  function capturingSet() {
    const store = {};
    const set = obj => { Object.assign(store, obj); return Promise.resolve({ ok: true }); };
    return { set, store };
  }

  const JB_URL = 'https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007';
  const PROFILE = { fullName: 'Alex Morgan', email: 'alex.morgan@example.com' };
  const RESUME = { name: 'cv.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' };

  /* post a queue-open exactly as app/js/queue/queue-autoapply.js does */
  function postQueueOpen(over) {
    window.postMessage(Object.assign(
      { __careerpilot: true, kind: 'queue-open', url: JB_URL, token: 'tok', jobId: 'anduril', profile: PROFILE, resume: RESUME },
      over || {}), '*');
  }

  const CASES = [

    ['1 · background stores the one-shot intent for a valid cp-queue-open', async () => {
      const { set, store } = capturingSet();
      const res = await CPBackground.handleMessage(
        { type: 'cp-queue-open', url: JB_URL, token: 'tok-1', jobId: 'anduril', profile: PROFILE, resume: RESUME },
        { set, now: 1000 });
      assert(res.ok && res.stored, 'should report stored: ' + JSON.stringify(res));
      assert(store[CPBackground.PENDING].url === JB_URL && store[CPBackground.PENDING].token === 'tok-1', 'pending wrong');
      assert(store[CPBackground.DATA].profile.email === 'alex.morgan@example.com' && store[CPBackground.DATA].resume.name === 'cv.pdf', 'payload wrong');
      assert(store[CPBackground.SIGNAL].token === 'tok-1', 'signal-log wrong');
      return 'intent + payload + signal-log all stored';
    }],

    ['2 · background ignores a malformed queue-open (no url/token → nothing stored)', async () => {
      const { set, store } = capturingSet();
      const r1 = await CPBackground.handleMessage({ type: 'cp-queue-open', token: 't' }, { set });
      const r2 = await CPBackground.handleMessage({ type: 'cp-queue-open', url: JB_URL }, { set });
      assert(!r1.ok && !r2.ok && Object.keys(store).length === 0, 'malformed must store nothing');
      return 'no url or no token → not stored';
    }],

    ['3 · background ignores unknown message types', async () => {
      const { set, store } = capturingSet();
      const r = await CPBackground.handleMessage({ type: 'nope', url: JB_URL, token: 't' }, { set });
      assert(!r.ok && Object.keys(store).length === 0, 'unknown type writes nothing');
      return 'unknown message type ignored';
    }],

    ['4 · bridge records a "loaded" marker on load (popup: Bridge loaded ✓)', () => {
      const b = window.__store.cp_bridge_status;
      assert(b && b.loaded === true && typeof b.ts === 'number', 'bridge should mark itself loaded: ' + JSON.stringify(b));
      assert(typeof b.origin === 'string', 'loaded marker records the origin');
      return 'cp_bridge_status.loaded = true';
    }],

    ['5 · bridge forwards a postMessage(queue-open) → runtime.sendMessage(cp-queue-open) + records the event', async () => {
      window.__sent.length = 0;
      postQueueOpen({ token: 'tok-b' });
      await tick();
      assert(window.__sent.length === 1, 'exactly one message forwarded, got ' + window.__sent.length);
      const m = window.__sent[0];
      assert(m.type === 'cp-queue-open' && m.url === JB_URL && m.token === 'tok-b', 'forwarded message wrong: ' + JSON.stringify(m));
      assert(m.profile && m.profile.email === 'alex.morgan@example.com' && m.resume.name === 'cv.pdf', 'payload not forwarded');
      const ev = window.__store.cp_last_queue_event;
      assert(ev && ev.url === JB_URL && ev.token === 'tok-b', 'cp_last_queue_event not recorded: ' + JSON.stringify(ev));
      return 'postMessage → runtime message + last-queue-event marker';
    }],

    ['6 · bridge ignores a postMessage missing url/token or signature (nothing forwarded)', async () => {
      window.__sent.length = 0;
      postQueueOpen({ url: undefined });                                   // no url
      window.postMessage({ kind: 'queue-open', url: JB_URL, token: 't' }, '*');   // unsigned
      window.postMessage({ __careerpilot: true, kind: 'other', url: JB_URL, token: 't' }, '*'); // wrong kind
      await tick();
      assert(window.__sent.length === 0, 'malformed / unsigned messages must not be forwarded');
      return 'guards on signature + url/token';
    }],

    ['7 · bridge ACKs back to the page after forwarding (app can confirm the extension is connected)', async () => {
      let ack = null;
      const onMsg = ev => { const d = ev.data; if (d && d.__careerpilot_from_ext === true && d.kind === 'queue-open-ack') ack = d; };
      window.addEventListener('message', onMsg);
      window.__sent.length = 0;
      postQueueOpen({ token: 'tok-ack' });
      await tick(40);
      window.removeEventListener('message', onMsg);
      assert(ack && ack.ok === true && ack.token === 'tok-ack', 'expected an ok ACK for the forwarded intent: ' + JSON.stringify(ack));
      return 'queue-open-ack (ok) posted back to the page';
    }],

    ['8 · end-to-end: postMessage → bridge → background stores the intent', async () => {
      window.__sent.length = 0;
      postQueueOpen({ token: 'tok-e2e' });
      await tick();
      assert(window.__sent.length === 1, 'bridge should forward one message');
      const { set, store } = capturingSet();
      const res = await CPBackground.handleMessage(window.__sent[0], { set, now: 2000 });
      assert(res.ok && res.stored, 'background should store the forwarded intent');
      assert(store[CPBackground.PENDING].url === JB_URL && store[CPBackground.PENDING].token === 'tok-e2e', 'stored intent must match');
      return 'full localhost chain wires the queue intent into chrome.storage.local';
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
    console.log(`Queue→ATS messaging: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
