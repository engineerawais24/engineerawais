/* ============================================================
   Sprint 15 test harness — Live Connector Integration Layer.
   Runs in the browser (no Node/CLI runtime in this project).
   Open app/tests/sprint15.html to execute. Snapshots ALL
   localStorage and restores it in a finally block.

   Covers PART 10:
     1  connector lifecycle (all 8 methods + a healthy run)
     2  authentication placeholders (8 connectors, no credentials)
     3  status transitions (healthy/error/rate_limited/auth/offline/maintenance)
     4  rate limiting (quota, backoff, cooldown, reset)
     5  normalization (canonical validation + missing flags)
     6  deduplication (url + fuzzy, source priority, reasons)
     7  analytics (counts + success rate + avg response)
     8  admin diagnostics render
     9  existing sprints unchanged + connectors read-only (PART 9)
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function makeItem(id) {
    const job = JobSchema.normalized({
      id: id, source: 'Greenhouse', sourceJobId: id.toUpperCase(),
      title: 'Solutions Engineer', company: 'Acme Cloud',
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 120, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year', visaSponsorship: true,
      description: 'Own technical delivery. Terraform, Kubernetes and Azure across client onboarding.',
      skills: ['Terraform', 'Kubernetes', 'Azure', 'Python'], preferredSkills: ['SQL'],
      applyUrl: 'https://boards.example.com/' + id,
    });
    return { job, res: { score: 88, matched: ['Terraform', 'Kubernetes', 'Azure'], missing: [] },
      decision: { outcome: 'auto_approve', recommendation: 'Strong Match', confidence: 'High', reasons: [{ ok: true, text: 'ok' }] } };
  }

  const LIFECYCLE_METHODS = ['initialize', 'authenticate', 'healthCheck', 'searchJobs', 'normalize', 'validate', 'rateLimit', 'shutdown'];
  const CONNECTORS = ['linkedin', 'bayt', 'gulftalent', 'greenhouse', 'lever', 'workday', 'smartrecruiters', 'careers'];

  const CASES = [

    ['1 · Connector lifecycle (contract + healthy run)', () => {
      assert(Connectors.all().length === 8, 'expected 8 connectors');
      Connectors.all().forEach(a => LIFECYCLE_METHODS.forEach(m => assert(typeof a[m] === 'function', a.id + ' missing ' + m)));
      RateLimitManager.clear(); ConnectorConfig.clear(); ConnectorAnalytics.reset();
      const r = ConnectorIntegration.lifecycle('linkedin');
      assert(r.status === 'healthy', 'expected healthy, got ' + r.status);
      assert(r.analytics && r.analytics.searched > 0, 'no jobs searched');
      assert(r.jobCount >= 0 && (r.accepted + r.rejected) === r.analytics.searched, 'accept/reject bookkeeping off');
      return '8 connectors implement all 8 lifecycle methods; a demo run returns healthy';
    }],

    ['2 · Authentication placeholders (no credentials)', () => {
      ConnectorConfig.clear();
      const strategies = new Set();
      CONNECTORS.forEach(id => {
        const strat = ConnectorAuth.strategyFor(id);
        assert(ConnectorAuth.STRATEGIES.indexOf(strat) !== -1, 'bad strategy for ' + id);
        strategies.add(strat);
        const a = ConnectorAuth.authenticate(id);
        ['ok', 'state', 'strategy', 'mode', 'reason'].forEach(k => assert(k in a, id + ' auth missing ' + k));
        assert(a.mode === 'demo' && a.state === 'ready', id + ' should be ready in demo mode');
        assert(!('token' in a) && !('password' in a) && !('credential' in a), id + ' must never expose a credential');
      });
      ['oauth', 'api_key', 'session', 'none'].forEach(s => assert(strategies.has(s), 'missing strategy coverage: ' + s));
      return '8 connectors, strategies ' + Array.from(strategies).join('/') + '; demo=ready, no credentials';
    }],

    ['3 · Status transitions', () => {
      RateLimitManager.clear(); ConnectorConfig.clear();
      /* the ATS boards (greenhouse/lever/workday) ship disabled by
         default; a status-transition test must ENABLE the board so
         the disabled-check doesn't (correctly) short-circuit first. */
      const enableBoard = id => { const s = SourcesStore.load(); if (s.boards[id]) { s.boards[id].enabled = true; SourcesStore.save(s); } };
      const cases = [
        ['linkedin', 'none', 'healthy'],
        ['bayt', 'failed', 'error'],
        ['gulftalent', 'rate_limited', 'rate_limited'],
        ['greenhouse', 'auth_required', 'auth_required'],
        ['lever', 'offline', 'offline'],
        ['workday', 'maintenance', 'maintenance'],
      ];
      cases.forEach(([id, sim, expect]) => {
        enableBoard(id);
        assert(ConnectorConfig.set(id, { simulate: sim }).ok, 'set simulate failed ' + id);
        const r = ConnectorIntegration.lifecycle(id);
        assert(r.status === expect, `${id}/${sim} → expected ${expect}, got ${r.status}`);
        assert(r.statusLabel && r.statusLabel.length > 0, id + ' missing status label');
        ConnectorConfig.set(id, { simulate: 'none' });
      });
      return 'none→healthy · failed→error · rate_limited · auth_required · offline · maintenance';
    }],

    ['4 · Rate limiting (quota, backoff, cooldown, reset)', () => {
      RateLimitManager.clear();
      RateLimitManager.configure('t', { dailyQuota: 3 });
      assert(RateLimitManager.check('t').allowed, 'should start allowed');
      RateLimitManager.record('t'); RateLimitManager.record('t'); RateLimitManager.record('t');
      const over = RateLimitManager.check('t');
      assert(!over.allowed && over.reason === 'quota', 'quota not enforced');
      // exponential backoff cooldown
      RateLimitManager.clear();
      const p1 = RateLimitManager.penalize('t2');
      const p2 = RateLimitManager.penalize('t2');
      assert(p2.backoffLevel === 2 && p2.cooldownMs > p1.cooldownMs, 'backoff not exponential');
      assert(!RateLimitManager.check('t2').allowed && RateLimitManager.check('t2').reason === 'cooldown', 'cooldown not active');
      // retry-after wins
      const p3 = RateLimitManager.penalize('t3', 5000);
      assert(Math.abs((p3.cooldownUntil - Date.now()) - 5000) < 500, 'retry-after not honored');
      // reset clears backoff
      RateLimitManager.reset('t2');
      assert(RateLimitManager.check('t2').allowed && RateLimitManager.status('t2').backoffLevel === 0, 'reset failed');
      return 'daily quota enforced · exponential backoff · retry-after · reset';
    }],

    ['5 · Normalization (canonical validation + flags)', () => {
      const good = JobSchema.normalized({ source: 'Greenhouse', sourceJobId: 'g1', title: 'Engineer', company: 'Acme', location: 'Dubai', workMode: 'Remote', employmentType: 'Full-time', applyUrl: 'https://x/1', postedDate: '2026-01-01', salary: 100, salaryDisclosed: true, skills: ['SQL'], description: 'Build things.' });
      const gr = ConnectorIntegration.normalizationCheck(good);
      assert(gr.valid && gr.missing.length === 0, 'complete job should be valid: ' + gr.missing.join(','));
      const bad = JobSchema.normalized({ source: 'Greenhouse', sourceJobId: 'g2', title: 'Engineer', company: 'Acme', location: 'Dubai', workMode: 'Remote', employmentType: 'Full-time', applyUrl: 'https://x/2', postedDate: '2026-01-01', salaryDisclosed: false, skills: [], description: '' });
      const br = ConnectorIntegration.normalizationCheck(bad);
      assert(!br.valid, 'incomplete job should be flagged');
      assert(br.missing.indexOf('skills') !== -1 && br.missing.indexOf('description') !== -1, 'missing fields not flagged: ' + br.missing.join(','));
      // undisclosed salary is NOT a missing field
      assert(br.missing.indexOf('salary') === -1, 'undisclosed salary wrongly flagged');
      return 'complete job valid; empty skills/description flagged; undisclosed salary allowed';
    }],

    ['6 · Deduplication (url + fuzzy, priority, reasons)', () => {
      const j = (id, source, company, title, loc, url) => JobSchema.normalized({ id, source, sourceJobId: id, company, title, location: loc, workMode: 'Hybrid', employmentType: 'Full-time', applyUrl: url, postedDate: '2026-01-01', skills: ['x'], description: 'd', salaryDisclosed: false });
      const jobs = [
        j('li-1', 'LinkedIn', 'Acme', 'Solutions Engineer', 'Dubai · Hybrid', 'https://x.com/a'),
        j('gh-1', 'Greenhouse', 'Acme', 'Solutions Engineer', 'Dubai · Hybrid', 'https://y.com/b'),   // fuzzy dup
        j('bt-1', 'Bayt', 'Acme', 'Solutions Engineer', 'Dubai', 'https://x.com/a?ref=1'),             // exact-url dup
        j('lv-9', 'Lever', 'Globex', 'Data Analyst', 'Remote · US', 'https://z.com/c'),                // unique
      ];
      const d = Deduplicator.dedupe(jobs);
      assert(d.stats.unique === 2, 'expected 2 unique, got ' + d.stats.unique);
      assert(d.stats.duplicates === 2, 'expected 2 duplicates');
      assert(d.merged.every(m => m.kept.source === 'LinkedIn'), 'source priority not applied (LinkedIn should win)');
      assert(d.stats.byReason['exact-url'] === 1, 'exact-url reason not tracked');
      assert(Object.keys(d.stats.byReason).some(k => /fuzzy/.test(k)), 'fuzzy reason not tracked');
      // provenance merged onto survivor
      const keeper = d.unique.find(u => u.id === 'li-1');
      assert(keeper.sources.length >= 2, 'merged sources not recorded');
      return '4→2 unique · LinkedIn kept by priority · exact-url + fuzzy reasons tracked';
    }],

    ['7 · Analytics (counts + success rate + avg)', () => {
      ConnectorAnalytics.reset();
      ConnectorAnalytics.record('t', { searched: 10, normalized: 10, accepted: 8, rejected: 2, responseMs: 50, ok: true });
      ConnectorAnalytics.record('t', { ok: false, error: 'boom', responseMs: 100 });
      ConnectorAnalytics.addDuplicates('t', 3);
      const s = ConnectorAnalytics.summary('t');
      assert(s.runs === 2 && s.successes === 1 && s.errors === 1, 'run/success/error counts wrong');
      assert(s.searched === 10 && s.accepted === 8 && s.rejected === 2 && s.duplicatesRemoved === 3, 'job counts wrong');
      assert(s.successRate === 50, 'success rate wrong: ' + s.successRate);
      assert(s.avgResponseMs === 75, 'avg response wrong: ' + s.avgResponseMs);
      return '2 runs · 50% success · avg 75ms · 8 accepted / 2 rejected / 3 dupes';
    }],

    ['8 · Admin diagnostics render', () => {
      RateLimitManager.clear(); ConnectorConfig.clear(); ConnectorAnalytics.reset();
      const cards = ConnectorIntegration.adminCards();
      ['Connector analytics', 'Rate-limit status', 'Authentication status', 'Normalization health', 'Deduplication statistics', 'Integration search history']
        .forEach(t => assert(cards.indexOf(t) !== -1, 'admin cards missing: ' + t));
      const full = AdminView.render();
      assert(full.indexOf('CONNECTOR INTEGRATION LAYER') !== -1 && full.indexOf('Connector analytics') !== -1, 'admin route did not embed connector diagnostics');
      return 'all 6 connector diagnostics panels render inside /admin';
    }],

    ['9 · Existing sprints unchanged + connectors read-only', () => {
      // existing job→prep→submit→interview flow still works
      const item = makeItem('s15-reg-1');
      Prep.buildFor(item);
      assert(Prep.markReady(item.job.id) === true, 'markReady broke');
      const rec = SubmissionEngine.approveAndSubmit(item.job.id);
      assert(rec && rec.status === 'submitted', 'submission broke');
      ApplicationMemory.syncFromSubmissions();
      assert(ApplicationMemory.get(item.job.id).submitted.answers.length === 13, 'interview memory broke');
      assert(Connectors.all().length === 8 && Array.isArray(ConnectorManager.collect()), 'connector framework/pipeline broke');
      assert(JobSchema.REQUIRED_FIELDS.length === 16, 'job schema changed');
      assert(typeof AppStorage !== 'undefined' && AppStorage.healthCheck().ok && typeof SyncManager !== 'undefined', 'platform layer changed');
      // PART 9: the integration layer is READ-ONLY on user data
      const before = {
        prep: localStorage.getItem('careerpilot_prep_v1'),
        apps: JSON.stringify(ApplicationsStore.load()),
        mem: localStorage.getItem('careerpilot_appmemory_v1'),
        profile: localStorage.getItem('careerpilot_profile_v1'),
      };
      ConnectorIntegration.run();
      assert(localStorage.getItem('careerpilot_prep_v1') === before.prep, 'integration modified prep packages');
      assert(JSON.stringify(ApplicationsStore.load()) === before.apps, 'integration modified applications board');
      assert(localStorage.getItem('careerpilot_appmemory_v1') === before.mem, 'integration modified interview memory');
      assert(localStorage.getItem('careerpilot_profile_v1') === before.profile, 'integration modified profile');
      return 'submit+interview intact · 8 connectors · schema/platform intact · integration run is read-only';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('careerpilot_platform.') === 0) kill.push(k); }
      kill.concat(['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1', 'careerpilot_profile_v1', ConnectorConfig.KEY, SourcesStore.KEY, SyncLog.KEY]).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
      CASES.forEach(([name, fn]) => {
        try { results.push({ name, pass: true, detail: fn() || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      });
    } finally {
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
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
        <div><b>${r.name}</b><div class="detail">${r.detail}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 15: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
