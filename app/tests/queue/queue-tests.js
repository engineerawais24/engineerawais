/* ============================================================
   Application Queue v1 — browser harness.

   Real ApplicationQueue + ApplicationPackages + AppStorage. window.open is
   stubbed to record opened URLs (no real tabs). localStorage is snapshotted
   and restored so the real profile/board are never touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  const opened = [];
  const realOpen = window.open;
  window.open = url => { opened.push(url); return { closed: false, focus() {} }; };

  function makePkg(id, url) {
    return ApplicationPackages.createFrom({
      job: {
        id, title: 'Engineer ' + id, company: 'Co ' + id, location: 'Remote',
        source: 'Test', applyUrl: url || ('https://apply.example.com/' + id), description: 'd',
      },
      res: { score: 80 },
    });
  }

  function reset(n) {
    ApplicationPackages.clear();
    ApplicationQueue.finish();       // clears the queue key
    opened.length = 0;
    const ids = [];
    for (let i = 1; i <= (n || 0); i++) { makePkg('j' + i); ids.push('j' + i); }
    return ids;
  }

  const CASES = [

    ['1 · Start opens the first approved job in a new tab & tracks current', () => {
      reset(3);
      const r = ApplicationQueue.start();
      assert(r.ok && r.started, 'start should succeed: ' + JSON.stringify(r));
      assert(r.currentId === 'j1', 'current should be the first approved job');
      assert(opened.length === 1 && opened[0] === 'https://apply.example.com/j1', 'first job not opened in a tab');
      assert(ApplicationQueue.current().jobId === 'j1', 'current() should resolve the first package');
      const s = ApplicationQueue.state();
      assert(s.active && s.order.length === 3 && s.currentId === 'j1', 'queue state not tracked');
      return 'opened j1 · current = j1 · order = 3';
    }],

    ['2 · Mark Applied → package applied + auto-select next', () => {
      reset(3); ApplicationQueue.start();
      const r = ApplicationQueue.markApplied();
      assert(r.ok && r.applied, 'markApplied should apply: ' + JSON.stringify(r));
      assert(ApplicationPackages.forJob('j1').status === 'applied', 'package j1 not marked applied on the board');
      assert(ApplicationQueue.state().currentId === 'j2', 'did not auto-select the next job');
      assert(ApplicationPackages.ready().map(p => p.jobId).indexOf('j1') === -1, 'applied job still shows as ready');
      return 'j1 applied → current auto-advanced to j2';
    }],

    ['3 · Skip → package untouched + auto-select next', () => {
      reset(3); ApplicationQueue.start();
      const r = ApplicationQueue.skip();
      assert(r.ok, 'skip should succeed');
      assert(ApplicationPackages.forJob('j1').status === 'ready_to_apply', 'skip must not change the package status');
      assert(ApplicationQueue.state().currentId === 'j2', 'skip did not auto-select next');
      assert(ApplicationQueue.outcomeOf('j1') === 'skipped', 'j1 not recorded as skipped');
      return 'j1 skipped (unchanged) → current = j2';
    }],

    ['4 · Needs Attention → flags and STAYS on the current job', () => {
      reset(3); ApplicationQueue.start();
      const r = ApplicationQueue.needsAttention();
      assert(r.ok, 'needsAttention should succeed');
      assert(ApplicationQueue.state().currentId === 'j1', 'Needs Attention must not auto-advance');
      assert(ApplicationQueue.outcomeOf('j1') === 'attention', 'j1 not flagged');
      assert(ApplicationPackages.forJob('j1').status === 'ready_to_apply', 'flagging must not change the package');
      return 'j1 flagged · stays current';
    }],

    ['5 · Open Next — opens current when pending, advances when resolved', () => {
      reset(3); ApplicationQueue.start();         // opens j1
      opened.length = 0;
      let r = ApplicationQueue.openNext();          // current j1 still pending → re-open j1
      assert(r.ok && r.currentId === 'j1' && opened.slice(-1)[0] === 'https://apply.example.com/j1', 'Open Next should open the pending current job');
      ApplicationQueue.needsAttention();            // resolve j1 (flag)
      opened.length = 0;
      r = ApplicationQueue.openNext();              // resolved → advance to j2 and open it
      assert(r.currentId === 'j2' && opened.slice(-1)[0] === 'https://apply.example.com/j2', 'Open Next should advance past a resolved job');
      return 'pending → opens current · resolved → advances + opens next';
    }],

    ['6 · Prevent duplicate processing', () => {
      reset(3); ApplicationQueue.start();
      /* (a) Start again while active RESUMES — it never rebuilds from j1 */
      ApplicationQueue.markApplied();               // current now j2
      const again = ApplicationQueue.start();
      assert(again.resumed === true, 'starting an active queue should resume');
      assert(ApplicationQueue.state().currentId === 'j2', 'resume must not reset current to j1');
      /* (b) a job applied OUTSIDE the queue is skipped when selecting next */
      ApplicationPackages.markApplied('pkg-j3');    // j3 applied elsewhere
      const r = ApplicationQueue.markApplied();     // apply j2 → next should skip already-applied j3
      assert(r.done === true && r.currentId === null, 'already-applied j3 should not be re-queued: ' + JSON.stringify(r));
      /* (c) markApplied is idempotent — no active current now */
      assert(ApplicationQueue.markApplied().ok === false, 'markApplied with no current should be a no-op');
      return 'resume (no rebuild) · applied-elsewhere skipped · idempotent';
    }],

    ['7 · Queue state is preserved across a browser refresh', () => {
      reset(3); ApplicationQueue.start();
      ApplicationQueue.markApplied();               // j1 applied, current j2
      ApplicationQueue.needsAttention();            // flag j2
      /* a refresh = a brand-new read from storage; the module keeps no
         in-memory cache, so re-reading must reflect everything */
      const persisted = AppStorage.get('application_queue');
      assert(persisted && persisted.active, 'queue not persisted to storage');
      assert(persisted.currentId === 'j2', 'current job not preserved');
      assert(persisted.outcomes.j1 === 'applied' && persisted.outcomes.j2 === 'attention', 'outcomes not preserved');
      assert(ApplicationQueue.state().currentId === 'j2', 'state() should reload from storage');
      assert(ApplicationQueue.current().jobId === 'j2', 'current() should resolve after a refresh');
      return 'order + outcomes + current survive a reload';
    }],

    ['8 · Completion + finish clears the queue', () => {
      reset(2); ApplicationQueue.start();
      ApplicationQueue.markApplied();
      ApplicationQueue.markApplied();
      const s = ApplicationQueue.state();
      assert(!s.currentId && s.completedAt, 'queue should be complete with no current job');
      const prog = ApplicationQueue.progress();
      assert(prog.applied === 2 && prog.done, 'progress should show 2 applied and done');
      ApplicationQueue.finish();
      assert(!ApplicationQueue.isActive() && AppStorage.get('application_queue') == null, 'finish should clear the queue');
      return '2/2 applied → complete → finished (cleared)';
    }],

    ['9 · Never auto-submits — Mark Applied opens nothing; only Open Next opens', () => {
      reset(2); ApplicationQueue.start();
      opened.length = 0;
      ApplicationQueue.markApplied();               // records applied on the board only
      assert(opened.length === 0, 'Mark Applied must not open or submit anything');
      assert(ApplicationPackages.forJob('j1').status === 'applied', 'the only effect is a status change');
      ApplicationQueue.openNext();                  // opening is always explicit
      assert(opened.length === 1, 'Open Next is the only thing that opens a tab');
      return 'apply = status only · opening is explicit · nothing submitted';
    }],

    ['10 · Start with no approved jobs is a clean no-op', () => {
      reset(0);
      const r = ApplicationQueue.start();
      assert(!r.ok && /no approved/i.test(r.error), 'empty start should report no jobs: ' + JSON.stringify(r));
      assert(!ApplicationQueue.isActive(), 'no queue should be created');
      return 'no approved jobs → nothing started';
    }],

    ['11 · QueueView.card() renders every state without throwing', () => {
      reset(0);
      assert(QueueView.card() === '', 'no approved jobs → empty card');
      reset(2);
      assert(/Start Applying/.test(QueueView.card()), 'ready state should offer Start Applying');
      ApplicationQueue.start();
      const active = QueueView.card();
      assert(/Mark Applied/.test(active) && /Engineer j1/.test(active), 'active card should show the current job + buttons');
      ApplicationQueue.markApplied(); ApplicationQueue.markApplied();
      assert(/complete/i.test(QueueView.card()), 'completed queue should render a completion card');
      return 'empty · ready · active · complete all render';
    }],
  ];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function run() {
    return CASES.map(([name, fn]) => {
      try { return { name, pass: true, detail: fn() || '' }; }
      catch (e) { return { name, pass: false, detail: e.message }; }
    });
  }

  function guardedRun() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    let results;
    try { localStorage.clear(); results = run(); }
    finally {
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
      window.open = realOpen;         // restore the real API
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
    console.log(`Application Queue: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(guardedRun()));
})();
