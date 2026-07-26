/* ============================================================
   Queue → ATS Auto Autofill v1 — app-side harness (QueueAutoApply).

   Real QueueAutoApply + ApplicationQueue + ApplicationPackages + ProfileStore
   + MasterResume. window.open is stubbed; localStorage is snapshotted and
   restored so no real data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  const realOpen = window.open;
  window.open = () => ({ closed: false, focus() {} });

  function makePkg(id) {
    return ApplicationPackages.createFrom({
      job: { id, title: 'Eng ' + id, company: 'Co ' + id, applyUrl: 'https://apply.example.com/' + id, description: 'd' },
      res: { score: 80 },
    });
  }
  function resetQueue(n) {
    ApplicationPackages.clear();
    ApplicationQueue.finish();
    for (let i = 1; i <= (n || 0); i++) makePkg('j' + i);
  }

  const CASES = [

    ['1 · buildAutofillProfile flattens the app profile correctly', () => {
      const nested = {
        personal: { firstName: 'Alex', lastName: 'Morgan', headline: 'Cloud Engineer', summary: 'S.' },
        contact: { email: 'alex@example.com', phone: '+971', city: 'Dubai', country: 'United Arab Emirates' },
        links: { linkedin: 'https://li/in/alex' },
        employment: { title: 'Engineer', company: 'TechVantage', startDate: '2021-03', noticePeriod: '1 month' },
        history: [{ startDate: '2019-06' }],
        authorization: { status: 'Citizen', authorizedIn: 'United Arab Emirates, Pakistan', sponsorship: false, gender: 'Male', maritalStatus: 'Single' },
        preferences: { relocation: true },
      };
      const f = QueueAutoApply.buildAutofillProfile(nested);
      assert(f.fullName === 'Alex Morgan' && f.firstName === 'Alex' && f.email === 'alex@example.com', 'name/email');
      assert(f.city === 'Dubai' && f.country === 'United Arab Emirates', 'location');
      assert(f.currentTitle === 'Engineer' && f.currentCompany === 'TechVantage', 'employment');
      assert(f.nationality === 'United Arab Emirates', 'nationality from Citizen + authorizedIn: ' + f.nationality);
      assert(f.workAuthorization === 'Citizen — authorized in United Arab Emirates, Pakistan', 'work auth: ' + f.workAuthorization);
      assert(f.needsSponsorship === false && f.willRelocate === true, 'sponsorship/relocate booleans');
      assert(f.gender === 'Male' && f.maritalStatus === 'Single', 'gender/marital');
      assert(/^\d+$/.test(f.yearsExperience) && Number(f.yearsExperience) >= 6, 'years from history: ' + f.yearsExperience);
      assert(f.linkedin === 'https://li/in/alex', 'linkedin');
      return 'flat autofill profile mapped from nested app profile';
    }],

    ['2 · signalOpen dispatches the queue-open event with the payload', () => {
      const p = ProfileStore.defaults();
      p.personal.firstName = 'Alex'; p.personal.lastName = 'Morgan'; p.contact.email = 'alex@example.com';
      ProfileStore.save(p);
      MasterResume.importRecord({ name: 'Alex_CV.pdf', kind: 'pdf', mime: 'application/pdf', size: 100, data: 'data:application/pdf;base64,AAAA' });

      let detail = null;
      const handler = ev => { detail = ev.detail; };
      document.addEventListener('careerpilot:queue-open', handler);
      const token = QueueAutoApply.signalOpen({ jobId: 'j1', url: 'https://boards.greenhouse.io/acme/jobs/1' });
      document.removeEventListener('careerpilot:queue-open', handler);

      assert(token && /^cpq-j1-/.test(token), 'token format: ' + token);
      assert(detail && detail.url === 'https://boards.greenhouse.io/acme/jobs/1' && detail.jobId === 'j1' && detail.token === token, 'event detail basics');
      assert(detail.profile && detail.profile.fullName === 'Alex Morgan' && detail.profile.email === 'alex@example.com', 'flat profile in the payload');
      assert(detail.resume && detail.resume.name === 'Alex_CV.pdf' && detail.resume.mime === 'application/pdf' && /^data:/.test(detail.resume.dataUrl), 'master résumé in the payload');
      return 'queue-open carries url + token + flat profile + résumé';
    }],

    ['2b · signalOpen ALSO posts a signed window.postMessage the bridge reads (the reliable path)', () => {
      const p = ProfileStore.defaults();
      p.personal.firstName = 'Alex'; p.personal.lastName = 'Morgan'; p.contact.email = 'alex@example.com';
      ProfileStore.save(p);

      const orig = window.postMessage;
      let posted = null;
      window.postMessage = (msg) => { if (msg && msg.__careerpilot) posted = msg; };   // spy on the call (sync)
      let token;
      const URL_EXACT = 'https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007';
      try { token = QueueAutoApply.signalOpen({ jobId: 'j1', url: URL_EXACT }); }
      finally { window.postMessage = orig; }

      assert(posted, 'signalOpen must window.postMessage a message for the content-script bridge');
      assert(posted.__careerpilot === true && posted.kind === 'queue-open', 'the message must be signed queue-open');
      assert(posted.url === URL_EXACT && posted.token === token, 'url + token forwarded to the bridge');
      assert(posted.profile && posted.profile.fullName === 'Alex Morgan', 'flat profile in the postMessage payload');
      return 'signalOpen → window.postMessage(queue-open) crosses into the bridge world';
    }],

    ['3 · signalOpen with no URL is a no-op', () => {
      let fired = false;
      const h = () => { fired = true; };
      document.addEventListener('careerpilot:queue-open', h);
      const t = QueueAutoApply.signalOpen({ jobId: 'j1' });
      document.removeEventListener('careerpilot:queue-open', h);
      assert(t === null && !fired, 'no url → no token, no event');
      return 'guards against a missing URL';
    }],

    ['4 · needs-attention event flags the right queued job', () => {
      resetQueue(2);
      ApplicationQueue.start();            // active, current j1
      QueueAutoApply.bind();
      document.dispatchEvent(new CustomEvent('careerpilot:needs-attention', { detail: { jobId: 'j2', reason: 'login' } }));
      const s = ApplicationQueue.state();
      assert(s.outcomes.j2 === 'attention', 'j2 should be flagged attention');
      assert(s.attentionReasons && s.attentionReasons.j2 === 'login', 'reason should be recorded');
      assert(ApplicationQueue.outcomeOf('j1') === 'pending', 'the current job j1 must be untouched');
      return 'blocked ATS tab → queued job flagged (login)';
    }],

    ['5 · markAttentionFor guards: applied & unknown jobs are never flagged', () => {
      resetQueue(2);
      ApplicationQueue.start();            // current j1
      ApplicationQueue.markApplied();      // j1 applied, current j2
      assert(!ApplicationQueue.markAttentionFor('j1', { reason: 'x' }).ok, 'an applied job must not be flagged');
      assert(['applied', 'done'].indexOf(ApplicationQueue.outcomeOf('j1')) !== -1, 'j1 stays applied');
      assert(!ApplicationQueue.markAttentionFor('nope', { reason: 'x' }).ok, 'an unknown job is a no-op');
      const r = ApplicationQueue.markAttentionFor('j2', { reason: 'captcha' });
      assert(r.ok && ApplicationQueue.outcomeOf('j2') === 'attention', 'a pending job can be flagged');
      return 'applied/unknown guarded · pending flaggable';
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
      window.open = realOpen;
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
    console.log(`Queue auto-apply (app): ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(guardedRun()));
})();
