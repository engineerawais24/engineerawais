/* ============================================================
   Sprint 18 harness — Intelligent Job Search Engine &
   Multi-Source Aggregation (FRONTEND).

   Runs in the browser. Providers use their LOCAL MOCK FEEDS (and
   injectable transports where a test needs failure/slowness) — no
   network, no scraping, no credentials, no submission.

   PART 11 coverage (15 required cases).
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const tick = (ms) => new Promise(r => setTimeout(r, ms || 20));

  const PROVIDER_IFACE = ['connect', 'search', 'normalize', 'health', 'disconnect'];
  const HEALTH_FIELDS = ['configured', 'connected', 'reachable', 'lastSuccessAt', 'lastFailureAt', 'resultCount', 'lastError'];

  function baseFilters(extra) { return Object.assign({ query: '' }, extra || {}); }
  function cacheKeyFor(filters) {
    const f = SearchEngine.normalizeFilters(filters);
    const ids = f.providers.length ? f.providers : SearchEngine.providerIds();
    const prefs = Profile.getState().preferences || {};
    return SearchCache.keyFor(f, ids, prefs);
  }

  const CASES = [

    ['1 · Provider interface consistency', async () => {
      const ps = SearchEngine.allProviders();
      assert(ps.length === 6, 'expected 6 providers, got ' + ps.length);
      ps.forEach(p => {
        PROVIDER_IFACE.forEach(m => assert(typeof p[m] === 'function', p.id + ' missing ' + m));
        const c = p.connect({});
        assert(c.ok === true, p.id + ' connect failed');
        const h = p.health();
        HEALTH_FIELDS.forEach(f => assert(f in h, p.id + ' health missing ' + f));
        assert(p.disconnect().ok === true, p.id + ' disconnect failed');
      });
      return '6 providers implement connect/search/normalize/health/disconnect + all 7 health fields';
    }],

    ['2 · A provider failure does not fail the whole search', async () => {
      /* ONLY Bayt gets a failing transport; every other provider gets
         `null` and therefore falls back to its own local mock feed. */
      const failing = async () => { throw new Error('provider down'); };
      const perProvider = (id) => (id === 'bayt' ? failing : null);
      const r = await SearchEngine.search(baseFilters(), { refresh: true, transport: perProvider, noBackgroundRefresh: true });
      const h = r.history;
      assert(h.providersFailed.indexOf('Bayt') !== -1, 'Bayt should be reported as failed');
      assert(h.providersCompleted.length >= 4, 'other providers should still complete');
      assert(r.jobs.length > 0, 'the search must still return results despite one provider failing');
      return `Bayt failed; ${h.providersCompleted.length} providers completed; ${r.jobs.length} results still returned`;
    }],

    ['3 · Normalization produces the unified job model', async () => {
      const p = SearchEngine.providerById('linkedin');
      const r = await p.search({}, {});
      assert(r.ok && r.jobs.length, 'provider returned no jobs');
      const j = r.jobs[0];
      BaseProvider.UNIFIED_FIELDS.forEach(f => assert(f in j, 'unified model missing field: ' + f));
      assert(BaseProvider.validate(j).length === 0, 'unified job failed validation');
      // no provider-specific field leaks
      ['jobId', 'jk', 'ref', 'gtId', 'absolute_url', 'hostedUrl', 'payMin'].forEach(k => assert(!(k in j), 'provider field leaked: ' + k));
      // consistent unknowns + ISO dates
      assert(Array.isArray(j.skills) && Array.isArray(j.providers) && Array.isArray(j.certifications), 'array fields wrong');
      assert(typeof j.remote === 'boolean' && typeof j.visaSupport === 'boolean' && typeof j.gccRelevant === 'boolean', 'boolean fields wrong');
      assert(/^\d{4}-\d{2}-\d{2}T/.test(j.postedAt), 'postedAt is not ISO: ' + j.postedAt);
      assert(BaseProvider.canonicalUrl('https://WWW.Example.com/a/?utm=1#x') === 'example.com/a', 'URL not canonicalized');
      return 'all 30 unified fields present · no provider fields leak · ISO dates · canonical URLs';
    }],

    ['4 · Duplicate jobs merge deterministically', async () => {
      const r = await SearchEngine.search(baseFilters(), { refresh: true, noBackgroundRefresh: true });
      assert(r.history.duplicateCount >= 2, 'expected >=2 cross-provider duplicates, got ' + r.history.duplicateCount);
      const merged = r.jobs.find(j => (j.providers || []).length > 1);
      assert(merged, 'no merged job found');
      assert(merged.mergeMeta.sourceUrls.length >= 2, 'source URLs not preserved on merge');
      assert(merged.mergeMeta.sourceIds.length >= 2, 'source IDs not preserved on merge');
      assert(merged.mergeMeta.merged.length >= 1, 'merge details not recorded');

      // deterministic: same input twice → identical output
      const p = SearchEngine.providerById('linkedin');
      const q = SearchEngine.providerById('indeed');
      const a = (await p.search({}, {})).jobs.concat((await q.search({}, {})).jobs);
      const d1 = SearchEngine.deduplicate(a);
      const d2 = SearchEngine.deduplicate(a);
      assert(JSON.stringify(d1.jobs) === JSON.stringify(d2.jobs), 'deduplication is NOT deterministic');
      assert(d1.duplicateCount === d2.duplicateCount, 'duplicate count not stable');
      return `${r.history.duplicateCount} duplicates merged; providers[] + source URLs/IDs preserved; repeat runs identical`;
    }],

    ['5 · Ranking produces a stable 0–100 score', async () => {
      const p = SearchEngine.providerById('bayt');
      const jobs = (await p.search({}, {})).jobs;
      const ctx = SearchEngine.rankingContext({});
      const a = SearchRanking.score(jobs[0], ctx);
      const b = SearchRanking.score(jobs[0], ctx);
      assert(a.score >= 0 && a.score <= 100, 'score out of range: ' + a.score);
      assert(a.score === b.score, 'score is NOT deterministic (' + a.score + ' vs ' + b.score + ')');
      const ranked = SearchRanking.rank(jobs, ctx);
      for (let i = 1; i < ranked.length; i++) {
        assert(ranked[i - 1].ranking.score >= ranked[i].ranking.score, 'results not sorted by score');
      }
      assert(JSON.stringify(SearchRanking.rank(jobs, ctx).map(j => j.id)) === JSON.stringify(ranked.map(j => j.id)), 'rank order not stable');
      return `score ${a.score}/100 (${a.scoreBand}) · deterministic · sorted descending`;
    }],

    ['6 · Ranking explanation includes reasons, strengths and gaps', async () => {
      const jobs = (await SearchEngine.providerById('bayt').search({}, {})).jobs;
      const r = SearchRanking.score(jobs[0], SearchEngine.rankingContext({ excludedKeywords: ['unpaid'] }));
      ['score', 'scoreBand', 'reasons', 'strengths', 'gaps', 'warnings', 'matchedSkills', 'missingSkills',
        'salaryAssessment', 'locationAssessment', 'recommendation'].forEach(k => assert(k in r, 'missing output: ' + k));
      assert(Array.isArray(r.reasons) && r.reasons.length >= 8, 'reasons must explain every component');
      r.reasons.forEach(x => assert('component' in x && 'points' in x && 'text' in x, 'reason not explainable'));
      const sum = r.reasons.reduce((n, x) => n + x.points, 0);
      assert(Math.abs(Math.max(0, Math.min(100, Math.round(sum))) - r.score) <= 1, 'score is not the sum of its explained parts');
      assert(typeof r.salaryAssessment === 'string' && typeof r.locationAssessment === 'string', 'assessments missing');
      return `${r.reasons.length} explained components · strengths ${r.strengths.length} · gaps ${r.gaps.length} · ${r.recommendation}`;
    }],

    ['7 · Search cache hit works', async () => {
      SearchCache.clearAll(); SearchCache.resetStats();
      const f = baseFilters({ query: 'solutions' });
      const first = await SearchEngine.search(f, { refresh: true, noBackgroundRefresh: true });
      assert(first.history.cacheHit === false, 'first search should not be a cache hit');
      const second = await SearchEngine.search(f, { noBackgroundRefresh: true });
      assert(second.history.cacheHit === true, 'second identical search should hit the cache');
      assert(second.jobs.length === first.jobs.length, 'cached result count differs');
      assert(SearchCache.stats().hits >= 1, 'cache hit not counted');
      return `cache miss → write → hit (${second.jobs.length} results served from cache)`;
    }],

    ['8 · Expired cache triggers refresh behaviour', async () => {
      SearchCache.clearAll(); SearchCache.resetStats();
      const f = baseFilters({ query: 'engineer' });
      await SearchEngine.search(f, { refresh: true, ttlMs: 40, noBackgroundRefresh: true });
      const key = cacheKeyFor(f);
      const before = SearchCache.peek(key).createdAt;
      await tick(60);                                   // entry is now stale
      const r = await SearchEngine.search(f, { ttlMs: 40 });   // stale-while-refresh
      assert(r.history.cacheHit === true, 'stale entry should still be served instantly');
      assert(SearchCache.stats().staleHits >= 1, 'stale hit not counted');
      await tick(80);                                   // background refresh completes
      const after = SearchCache.peek(key).createdAt;
      assert(after > before, 'stale entry did not trigger a background refresh');
      return 'stale entry served instantly, then refreshed in the background';
    }],

    ['9 · Offline mode returns cached results', async () => {
      SearchCache.clearAll();
      const f = baseFilters({ query: 'architect' });
      const warm = await SearchEngine.search(f, { refresh: true, noBackgroundRefresh: true });
      assert(warm.jobs.length > 0, 'nothing cached to serve offline');
      const off = await SearchEngine.search(f, { offline: true });
      assert(off.history.offline === true, 'offline flag not set');
      assert(off.jobs.length === warm.jobs.length, 'offline search did not serve the cached results');
      // offline with NO cache is safe (empty, not an error)
      const cold = await SearchEngine.search(baseFilters({ query: 'zzz-nothing-cached' }), { offline: true });
      assert(cold.jobs.length === 0 && cold.history.offline === true, 'offline+no-cache should be empty and safe');
      return `${off.jobs.length} results served offline from cache; offline+no-cache is safe`;
    }],

    ['10 · Search history is stored and rerunnable', async () => {
      SearchEngine.clearHistory();
      const f = baseFilters({ query: 'solutions' });
      const r = await SearchEngine.search(f, { refresh: true, noBackgroundRefresh: true });
      const h = SearchEngine.getHistory();
      assert(h.length === 1, 'history not stored');
      const e = h[0];
      ['id', 'filters', 'providersRequested', 'providersCompleted', 'providersFailed', 'startedAt', 'completedAt',
        'durationMs', 'rawResultCount', 'duplicateCount', 'finalResultCount', 'cacheHit', 'offline', 'cancelled',
        'averageScore', 'topScore', 'errorSummary'].forEach(k => assert(k in e, 'history entry missing: ' + k));
      const again = await SearchEngine.rerun(r.searchId, { noBackgroundRefresh: true });
      assert(again.jobs.length === r.jobs.length, 'rerun did not reproduce the search');
      assert(SearchEngine.getHistory().length === 2, 'rerun not recorded in history');
      return 'all 17 history fields stored; rerun reproduced the search';
    }],

    ['11 · Cancellation stops an active search safely', async () => {
      const slow = async ({ signal }) => {
        await tick(40);
        if (signal && signal.aborted) throw new Error('cancelled');
        return { ok: true, jobs: [] };
      };
      const p = SearchEngine.search(baseFilters(), { refresh: true, providerTransport: slow, noBackgroundRefresh: true });
      await tick(5);
      const active = SearchEngine.activeSearches();
      assert(active.length === 1, 'no active search registered');
      const c = SearchEngine.cancel(active[0].id);
      assert(c.ok === true, 'cancel failed');
      const r = await p;                                  // must resolve, never throw
      assert(r.history.cancelled === true, 'search not marked cancelled');
      assert(SearchEngine.activeSearches().length === 0, 'active search not cleaned up');
      return 'active search cancelled; promise resolved safely; no active searches left';
    }],

    ['12 · Admin diagnostics report correct metrics', async () => {
      const d0 = SearchEngine.getDiagnostics();
      ['totalSearches', 'searchesToday', 'averageDurationMs', 'averageResultCount', 'cacheHitRate', 'staleCacheHits',
        'duplicateCount', 'averageRankingScore', 'providerHealth', 'providerFailureCount', 'lastSuccessfulSearch',
        'lastFailedSearch', 'activeSearch', 'cancelledSearchCount', 'offlineSearchCount'].forEach(k => assert(k in d0, 'diagnostics missing: ' + k));
      assert(d0.totalSearches > 0, 'no searches recorded');
      assert(d0.providerHealth.length === 6, 'provider health should cover all 6 providers');
      assert(d0.cancelledSearchCount >= 1, 'cancelled search not counted');   // left by test 11

      /* Diagnostics must read the SAME persisted search history the engine
         writes, and one completed offline search must increment the offline
         metric EXACTLY once — not zero (a metric that never moves) and not
         twice (double counting from reruns / cache hits / cancellations).
         Asserted against a fresh baseline so this case never depends on
         leftovers from earlier cases (test 10 legitimately clears history). */
      const off = await SearchEngine.search(baseFilters({ query: 'diag-offline' }), { offline: true });
      assert(off.history.offline === true, 'offline search not flagged on its history entry');
      const d1 = SearchEngine.getDiagnostics();
      assert(d1.offlineSearchCount === d0.offlineSearchCount + 1,
        'offline search must increment the metric exactly once (' + d0.offlineSearchCount + ' → ' + d1.offlineSearchCount + ')');
      assert(d1.totalSearches === d0.totalSearches + 1, 'total searches must increment exactly once');
      assert(d1.cancelledSearchCount === d0.cancelledSearchCount, 'an offline search must not change the cancelled count');
      assert(d1.offlineSearchCount === SearchEngine.getHistory().filter(h => h.offline).length,
        'diagnostics is not aggregating the same persisted search history the engine writes');

      const html = AdminView.render();
      assert(html.indexOf('SEARCH ENGINE') !== -1 && html.indexOf('Search engine') !== -1, 'admin does not render the search section');
      assert(html.indexOf('Clear expired cache') !== -1 && html.indexOf('Run diagnostics search') !== -1, 'admin actions missing');
      return `${d1.totalSearches} searches · offline metric +1 exactly · cancelled ${d1.cancelledSearchCount} unchanged · admin renders`;
    }],

    ['13 · Existing approval and decision workflow remains intact', async () => {
      const r = await SearchEngine.search(baseFilters(), { refresh: true, noBackgroundRefresh: true });
      const discovered = SearchEngine.toDiscovered(r.jobs);
      assert(discovered.length === r.jobs.length, 'toDiscovered lost jobs');
      discovered.forEach(j => assert(JobSchema.isValid(j), 'discovered job fails JobSchema: ' + JSON.stringify(JobSchema.validate(j))));
      JobsStore.setDiscovered(discovered);
      if (typeof Jobs !== 'undefined' && Jobs.reload) Jobs.reload();
      const evaluated = Jobs.evaluated();
      assert(evaluated.length > 0, 'Jobs.evaluated() returned nothing for the search results');
      assert(evaluated[0].res && evaluated[0].decision, 'MatchEngine/DecisionEngine did not run on search results');
      // decisions still work and are preserved
      const id = evaluated[0].job.id;
      Jobs.later(id);
      assert(JobsStore.load().decisions[id] === 'later', 'decision not persisted');
      assert(typeof MatchEngine !== 'undefined' && typeof DecisionEngine !== 'undefined', 'existing engines missing');
      return `${evaluated.length} search results flow through MatchEngine + DecisionEngine; decisions persist`;
    }],

    ['14 · No application submission occurs', async () => {
      const before = SubmissionStore.all().length;
      const beforeMem = ApplicationMemory.all().length;
      await SearchEngine.search(baseFilters(), { refresh: true, noBackgroundRefresh: true });
      await SearchEngine.refresh(baseFilters({ query: 'engineer' }), { noBackgroundRefresh: true });
      assert(SubmissionStore.all().length === before, 'a search created a submission');
      assert(ApplicationMemory.all().length === beforeMem, 'a search created an interview/application memory record');
      // the engine exposes no submit surface at all
      ['submit', 'apply', 'send'].forEach(k => assert(typeof SearchEngine[k] === 'undefined', 'SearchEngine must not expose ' + k));
      SearchEngine.allProviders().forEach(p => ['submit', 'apply'].forEach(k => assert(typeof p[k] === 'undefined', p.id + ' must not expose ' + k)));
      return 'no submissions, no application memory writes, no submit/apply surface anywhere';
    }],

    ['15 · Sprint 14–17 behaviour unchanged', async () => {
      assert(typeof AppStorage !== 'undefined' && AppStorage.healthCheck().ok, 'Sprint 14 storage broke');
      assert(typeof SyncManager !== 'undefined' && typeof SyncManager.flushNow === 'function', 'Sprint 17 sync broke');
      assert(typeof ConflictCenter !== 'undefined', 'Sprint 17 conflict center missing');
      assert(typeof Backend !== 'undefined' && Backend.mode() === 'local', 'Sprint 16/17 backend default changed');
      assert(Connectors.all().length === 8 && Array.isArray(ConnectorManager.collect()), 'Sprint 15 connectors broke');
      assert(typeof ConnectorIntegration !== 'undefined', 'Sprint 15 integration layer missing');
      assert(JobSchema.REQUIRED_FIELDS.length === 16, 'job schema changed');
      // the full prep → submit → interview flow still works
      const job = JobSchema.normalized({
        id: 's18-reg-1', source: 'Greenhouse', sourceJobId: 'S18-REG-1', title: 'Solutions Engineer', company: 'Acme Cloud',
        location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time', salary: 120, salaryDisclosed: true,
        currency: 'USD', salaryPeriod: 'year', visaSponsorship: true,
        description: 'Own technical delivery. Terraform, Kubernetes and Azure.',
        skills: ['Terraform', 'Kubernetes', 'Azure', 'Python'], preferredSkills: ['SQL'],
        applyUrl: 'https://boards.example.com/s18-reg-1',
      });
      const item = { job, res: { score: 88, matched: ['Terraform'], missing: [] }, decision: { outcome: 'auto_approve', recommendation: 'Strong Match', confidence: 'High', reasons: [] } };
      Prep.buildFor(item);
      assert(Prep.markReady(job.id) === true, 'approval gate broke');
      const rec = SubmissionEngine.approveAndSubmit(job.id);
      assert(rec && rec.status === 'submitted', 'submission gate broke');
      ApplicationMemory.syncFromSubmissions();
      assert(ApplicationMemory.get(job.id).submitted.answers.length === 13, 'interview memory broke');
      return 'storage, sync, conflicts, backend, connectors, prep/submit/interview all intact';
    }],
  ];

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      const kill = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('careerpilot_platform.') === 0) kill.push(k);
      }
      kill.concat(['careerpilot_prep_v1', 'careerpilot_submissions_v1', 'careerpilot_appmemory_v1',
        'careerpilot_profile_v1', 'careerpilot_jobs_v1', 'careerpilot_backend_cfg'])
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });

      for (const [name, fn] of CASES) {
        try { const d = await fn(); results.push({ name, pass: true, detail: d || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
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
    console.log(`Sprint 18: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
