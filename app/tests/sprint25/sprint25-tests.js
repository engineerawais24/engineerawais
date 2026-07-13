/* ============================================================
   Sprint 25 — Intelligent Multi-Source Job Discovery Engine.
   Browser harness. Async (providers are awaited). localStorage is
   snapshotted and restored, so no existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  const PROVIDER_IDS = ['linkedin', 'indeed', 'bayt', 'gulftalent'];

  function snapshot() {
    return JobMatchEngine.snapshotFromProfile(ProfileStore.demo());
  }

  /* put the registry back to the four shipped providers after a test
     swaps one out */
  function restoreRegistry() {
    JobDiscoveryService.unregister('mock');
    JobDiscoveryService.register('linkedin',   { label: 'LinkedIn',   weight: 0.92, resolve: () => (typeof LinkedInProvider   !== 'undefined' ? LinkedInProvider   : null) });
    JobDiscoveryService.register('indeed',     { label: 'Indeed',     weight: 0.80, resolve: () => (typeof IndeedProvider     !== 'undefined' ? IndeedProvider     : null) });
    JobDiscoveryService.register('bayt',       { label: 'Bayt',       weight: 0.85, resolve: () => (typeof BaytProvider       !== 'undefined' ? BaytProvider       : null) });
    JobDiscoveryService.register('gulftalent', { label: 'GulfTalent', weight: 0.85, resolve: () => (typeof GulfTalentProvider !== 'undefined' ? GulfTalentProvider : null) });
    JobDiscoveryService.reset();
  }

  const CASES = [

    ['1 · Provider loading', async () => {
      restoreRegistry();
      /* the four sources this sprint ships */
      PROVIDER_IDS.forEach(id => assert(JobDiscoveryService.registered().indexOf(id) !== -1, 'provider not registered: ' + id));
      assert(JobDiscoveryService.available().length === 4, 'expected 4 available providers, got ' + JobDiscoveryService.available().length);
      ['LinkedIn', 'Indeed', 'Bayt', 'GulfTalent'].forEach((label, i) =>
        assert(JobDiscoveryService.labelOf(PROVIDER_IDS[i]) === label, 'wrong label for ' + PROVIDER_IDS[i]));

      /* lazy: a provider is resolved on use, then memoized */
      let resolved = 0;
      JobDiscoveryService.register('mock', {
        label: 'MockBoard', weight: 1,
        resolve: () => { resolved++; return BaseProvider.createProvider({
          id: 'mock', label: 'MockBoard',
          normalize: r => r,
          demoFeed: () => [{ sourceId: 'm-1', title: 'Solutions Engineer', company: 'MockCo',
            location: 'Remote, United States', workMode: 'Remote', skills: ['Python'],
            description: 'A realistic mock posting used to prove a provider can be swapped in.',
            url: 'https://mock.example/jobs/1', postedAt: '2026-07-09', experienceMin: 5 }],
        }); },
      });
      assert(resolved === 0, 'the provider was resolved before it was ever used — not lazy');
      const p1 = JobDiscoveryService.instance('mock');
      const p2 = JobDiscoveryService.instance('mock');
      assert(resolved === 1, 'the provider was resolved more than once — not memoized');
      assert(p1 === p2 && p1.id === 'mock', 'the resolved provider is wrong');

      /* a real API can replace a mock with NO change to the UI or the service */
      const res = await JobDiscoveryService.search({ providers: ['mock'] });
      assert(res.ok && res.resultCount === 1, 'the swapped-in provider returned nothing');
      assert(res.jobs[0].providers.join() === 'MockBoard', 'the swapped-in provider is not credited');

      /* an unresolvable provider is reported, never thrown, and never fatal */
      JobDiscoveryService.register('ghost', { label: 'Ghost', resolve: () => null });
      const g = await JobDiscoveryService.search({ providers: ['ghost', 'mock'] });
      assert(g.ok === true, 'one unavailable provider must not fail the whole search');
      assert(g.providersFailed.join() === 'ghost', 'the unavailable provider was not reported');
      assert(g.resultCount === 1, 'the healthy provider’s results were lost');
      JobDiscoveryService.unregister('ghost');
      restoreRegistry();
      return '4 providers registered · resolved lazily and memoized · swappable · a dead provider is reported, not fatal';
    }],

    ['2 · Merged search results', async () => {
      restoreRegistry();
      const res = await JobDiscoveryService.search({}, { snapshot: snapshot() });

      assert(res.ok, 'the search failed');
      assert(res.providersOk.length === 4, 'not every provider was searched: ' + res.providersOk.join());
      assert(res.rawCount >= 10, 'expected the four mock feeds to return 10+ jobs, got ' + res.rawCount);
      assert(res.resultCount > 0, 'the merged list is empty');

      /* one unified list — every job carries the full model */
      res.jobs.forEach(j => {
        assert(DiscoveryJob.validate(j).length === 0, 'invalid job: ' + DiscoveryJob.validate(j).join(', '));
        DiscoveryJob.FIELDS.forEach(f => assert(f in j, 'unified model is missing ' + f));
        assert(DiscoveryJob.WORKPLACE.indexOf(j.workplaceType) !== -1, 'bad workplace type: ' + j.workplaceType);
        assert(DiscoveryJob.LEVELS.indexOf(j.experienceLevel) !== -1, 'bad experience level: ' + j.experienceLevel);
        assert(j.logo && j.logo.monogram && j.logo.color, 'the company logo placeholder is missing');
        assert(j.logo.placeholder === true && j.logo.url === null, 'the logo should be a placeholder until a real one exists');
        assert(typeof j.confidence === 'number' && j.confidence > 0, 'no confidence score');
        assert(Array.isArray(j.providers) && j.providers.length >= 1, 'the provider list is missing');
        assert(j.salary === null || (j.salary && j.salary.currency), 'salary must be null or a shaped object');
      });

      /* results from every board are present in the one list */
      const seen = new Set();
      res.jobs.forEach(j => j.providers.forEach(p => seen.add(p)));
      ['LinkedIn', 'Indeed', 'Bayt', 'GulfTalent'].forEach(p =>
        assert(seen.has(p), 'no jobs merged in from ' + p));
      return `${res.rawCount} raw → ${res.resultCount} merged from ${res.providersOk.length} providers in ${res.tookMs}ms`;
    }],

    ['3 · Duplicate removal', async () => {
      restoreRegistry();
      const res = await JobDiscoveryService.search({}, { snapshot: snapshot() });
      assert(res.duplicatesRemoved > 0, 'no duplicates were detected across the boards');
      assert(res.resultCount === res.filteredCount - res.duplicatesRemoved, 'the duplicate arithmetic does not add up');

      /* Careem's Senior Solutions Engineer is posted on BOTH LinkedIn and Indeed */
      const careem = res.jobs.filter(j => j.company === 'Careem');
      assert(careem.length === 1, 'Careem appears ' + careem.length + ' times — duplicates were not merged');
      const merged = careem[0];
      assert(merged.providers.length === 2, 'the merged job lost a provider: ' + merged.providers.join());
      ['LinkedIn', 'Indeed'].forEach(p => assert(merged.providers.indexOf(p) !== -1, 'provider not preserved: ' + p));

      /* the highest confidence of the two survives */
      const raw = res.providers.reduce((all, p) => all, []);
      const li = await JobDiscoveryService.instance('linkedin').search({}, {});
      const ind = await JobDiscoveryService.instance('indeed').search({}, {});
      const liCareem = DiscoveryJob.from(li.jobs.find(j => j.company === 'Careem'), { providerWeight: 0.92 });
      const inCareem = DiscoveryJob.from(ind.jobs.find(j => j.company === 'Careem'), { providerWeight: 0.80 });
      const best = Math.max(liCareem.confidence, inCareem.confidence);
      assert(merged.confidence === best, `the merged job kept ${merged.confidence}, not the highest confidence ${best}`);

      /* one card per job: no id appears twice */
      const ids = res.jobs.map(j => j.id);
      assert(new Set(ids).size === ids.length, 'duplicate cards in the merged list');

      /* merging is a pure function and never loses a source */
      const m = JobDiscoveryService.mergeJobs(liCareem, inCareem);
      assert(m.providers.length === 2 && m.confidence === best, 'mergeJobs did not merge correctly');
      assert(m.sourceUrls.length === 2 && m.sourceIds.length === 2, 'mergeJobs lost a source url/id');
      assert(liCareem.providers.length === 1, 'mergeJobs mutated its input');
      return `${res.duplicatesRemoved} duplicate(s) merged · Careem kept both boards · confidence ${merged.confidence} (highest of ${liCareem.confidence}/${inCareem.confidence})`;
    }],

    ['4 · Match scoring', async () => {
      restoreRegistry();
      const snap = snapshot();
      /* the shipped profile: Terraform, Kubernetes, Python, Client delivery, Azure, SQL
         + AZ-104 certification, targeting Solutions Engineer / Architect roles */
      assert(snap.skills.length === 6 && snap.certifications.length === 1, 'the profile snapshot is wrong');
      assert(snap.preferredTitles.length > 0, 'preferred titles were not read from the profile');

      const weights = JobMatchEngine.WEIGHTS;
      assert(JobMatchEngine.TOTAL === 100, 'the weights must total 100, got ' + JobMatchEngine.TOTAL);
      ['skills', 'experience', 'titles', 'locations', 'certifications']
        .forEach(k => assert(typeof weights[k] === 'number', 'missing weight: ' + k));

      /* a job built from the profile's own skills must score very high.
         It goes through BaseProvider.unified() first — the exact path a real
         provider result takes, so this exercises the true contract. */
      const perfect = DiscoveryJob.from(BaseProvider.unified({
        id: 'x-1', title: 'Senior Solutions Engineer', company: 'Acme', provider: 'LinkedIn',
        location: 'Remote, United States', workMode: 'Remote',
        skills: ['Terraform', 'Kubernetes', 'Python'], certifications: ['AZ-104 Azure Administrator'],
        description: 'A role that matches the profile exactly, for scoring.',
        url: 'https://acme.example/1', postedAt: '2026-07-09', experienceMin: 6,
      }), { providerWeight: 0.92 });
      assert(perfect.workplaceType === 'Remote', 'the unified record did not carry the workplace type');
      const good = JobMatchEngine.score(perfect, snap);
      assert(good.percentage >= 90, 'a perfect fit should score 90+, got ' + good.percentage);
      assert(good.matchedSkills.length === 3 && good.missingSkills.length === 0, 'skills were not matched');
      assert(good.matchedCertifications.length === 1, 'the certification was not matched');
      assert(good.parts.skills === weights.skills, 'a full skill match should earn every skill point');
      assert(good.parts.locations === weights.locations, 'a remote job should satisfy the location preference');

      /* an unrelated job must score far lower */
      const poor = DiscoveryJob.from(BaseProvider.unified({
        id: 'x-2', title: 'Junior Graphic Designer', company: 'Beta', provider: 'Indeed',
        location: 'Berlin, Germany', workMode: 'On-site',
        skills: ['Photoshop', 'Illustrator', 'Typography'], certifications: ['Adobe Certified'],
        description: 'Nothing to do with the profile, used to prove the scoring discriminates.',
        url: 'https://beta.example/2', postedAt: '2026-07-09', experienceMin: 1,
      }), { providerWeight: 0.8 });
      assert(poor.workplaceType === 'On Site', 'the unified record did not carry the workplace type');
      const bad = JobMatchEngine.score(poor, snap);
      assert(bad.percentage < 30, 'an unrelated job should score low, got ' + bad.percentage);
      assert(good.percentage > bad.percentage, 'the better job must outrank the worse one');

      /* every one of the five signals is exercised */
      assert(bad.parts.skills === 0, 'skills should score zero for an unrelated job');
      assert(bad.parts.certifications === 0, 'certifications should score zero when none match');
      assert(bad.parts.locations === 0, 'an unwanted on-site location should score zero');
      assert(bad.jobLevel === 'Entry' && good.jobLevel === 'Senior', 'the experience level was misread');

      /* deterministic, bounded, and applied to every discovered job */
      assert(JobMatchEngine.score(perfect, snap).percentage === good.percentage, 'scoring is not deterministic');
      const res = await JobDiscoveryService.search({}, { snapshot: snap });
      res.jobs.forEach(j => {
        assert(j.match && typeof j.match.percentage === 'number', 'a discovered job has no match score');
        assert(j.match.percentage >= 0 && j.match.percentage <= 100, 'match percentage out of range');
      });
      for (let i = 1; i < res.jobs.length; i++) {
        assert(res.jobs[i - 1].match.percentage >= res.jobs[i].match.percentage, 'results are not ranked by match');
      }
      return `perfect fit ${good.percentage}% · unrelated ${bad.percentage}% · every discovered job scored and ranked`;
    }],

    ['5 · Search filters', async () => {
      restoreRegistry();
      const snap = snapshot();
      const all = await JobDiscoveryService.search({}, { snapshot: snap });

      /* keywords */
      const kw = await JobDiscoveryService.search({ keywords: 'architect' }, { snapshot: snap });
      assert(kw.resultCount > 0 && kw.resultCount < all.resultCount, 'the keyword filter did not narrow the results');
      kw.jobs.forEach(j => assert(/architect/i.test(j.title + ' ' + j.summary + ' ' + j.skills.join(' ')),
        'a job that does not match the keyword got through: ' + j.title));

      /* location */
      const loc = await JobDiscoveryService.search({ location: 'Dubai' }, { snapshot: snap });
      assert(loc.resultCount > 0, 'the location filter returned nothing for Dubai');
      loc.jobs.forEach(j => assert(/dubai/i.test(j.location), 'a non-Dubai job got through: ' + j.location));

      /* remote only */
      const remote = await JobDiscoveryService.search({ remoteOnly: true }, { snapshot: snap });
      assert(remote.resultCount > 0, 'remote-only returned nothing');
      remote.jobs.forEach(j => assert(j.workplaceType === 'Remote', 'a non-remote job got through: ' + j.workplaceType));
      assert(remote.resultCount < all.resultCount, 'remote-only did not filter anything out');

      /* experience level */
      const senior = await JobDiscoveryService.search({ experienceLevel: 'Senior' }, { snapshot: snap });
      senior.jobs.forEach(j => assert(j.experienceLevel === 'Senior', 'a non-senior job got through: ' + j.experienceLevel));
      assert(senior.resultCount > 0 && senior.resultCount < all.resultCount, 'the experience filter did not narrow the results');

      /* salary range (annualised, in thousands) — and an undisclosed salary
         is never filtered out, the rule the board has always used */
      const paid = await JobDiscoveryService.search({ salaryMin: 170 }, { snapshot: snap });
      paid.jobs.forEach(j => assert(j.salaryK == null || j.salaryK >= 170,
        'a job under the salary floor got through: ' + j.title + ' @ ' + j.salaryK));
      const capped = await JobDiscoveryService.search({ salaryMax: 160 }, { snapshot: snap });
      capped.jobs.forEach(j => assert(j.salaryK == null || j.salaryK <= 160, 'a job over the salary ceiling got through'));

      /* filters combine */
      const combo = await JobDiscoveryService.search({ remoteOnly: true, experienceLevel: 'Lead' }, { snapshot: snap });
      combo.jobs.forEach(j => assert(j.workplaceType === 'Remote' && j.experienceLevel === 'Lead', 'the combined filter leaked'));

      /* an unknown level is ignored rather than blanking the board */
      const bogus = JobDiscoveryService.normalizeFilters({ experienceLevel: 'Wizard' });
      assert(bogus.experienceLevel === null, 'an invalid experience level must be ignored');
      return `keywords ${kw.resultCount} · Dubai ${loc.resultCount} · remote ${remote.resultCount} · senior ${senior.resultCount} · of ${all.resultCount} total`;
    }],

    ['6 · Today’s Jobs integration', async () => {
      restoreRegistry();
      JobsStore.clear();
      Jobs.reload();

      /* before discovery the board falls back to the sample feed — it is never blank */
      assert(Jobs.evaluated().length > 0, 'the board should never be empty');

      /* discovery publishes through the same channel the daily search uses */
      const res = await Jobs.discover({});
      assert(res && res.published > 0, 'discovery published nothing to the board');
      const discovered = JobsStore.load().discovered;
      assert(Array.isArray(discovered) && discovered.length === res.resultCount, 'the board did not receive the discovered jobs');

      /* every published record satisfies the board's own schema (Sprint 8) */
      discovered.forEach(j => {
        const problems = JobSchema.validate(j);
        assert(problems.length === 0, 'a published job breaks the board schema: ' + problems.join(', '));
        assert(['Remote', 'Hybrid', 'On-site'].indexOf(j.workMode) !== -1, 'bad workMode for the board: ' + j.workMode);
        assert(Array.isArray(j.providers) && j.providers.length >= 1, 'the provider list did not survive the adapter');
        assert(typeof j.confidence === 'number', 'the confidence score did not survive the adapter');
      });

      /* the board renders them through the UNCHANGED card — same markup as before */
      const items = Jobs.evaluated();
      assert(items.length === discovered.length, 'the board is not rendering the discovered jobs');
      assert(items[0].res && typeof items[0].res.score === 'number', 'MatchEngine no longer scores the board');
      assert(items[0].decision, 'DecisionEngine no longer runs on the board');
      const html = Jobs.render();
      ['job-card', 'MATCH', 'job-breakdown', 'job-resume', 'job-cover', 'job-search']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the Today’s Jobs UI changed — lost ' + k));

      /* the whole downstream workflow still runs on a discovered job */
      const job = items[0].job;
      Jobs.approve(job.id);
      assert(JobsStore.load().decisions[job.id] === 'approved', 'a discovered job cannot be approved');
      assert(ApplicationPackages.forJob(job.id), 'a discovered job did not produce an application package');
      assert(CoverLetter.get(job.id), 'a discovered job did not produce a cover letter');
      Jobs.undo(job.id);

      /* boot discovery never overwrites a board the user already has */
      const before = JSON.stringify(JobsStore.load().discovered);
      assert(Jobs.bootDiscovery() === null, 'boot discovery ran over an existing board');
      assert(JSON.stringify(JobsStore.load().discovered) === before, 'boot discovery overwrote the board');
      return `${res.published} jobs published · board schema valid · UI unchanged · approve → package → cover letter still work`;
    }],

    ['7 · Backward compatibility', async () => {
      restoreRegistry();
      /* Sprint 18's SearchEngine is untouched and still owns its own pipeline */
      assert(typeof SearchEngine !== 'undefined' && SearchEngine.providerIds().length === 6,
        'the Sprint 18 search engine was disturbed');
      /* the original MatchEngine is untouched — Sprints 20–24 depend on it */
      assert(Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0) === 100,
        'MatchEngine weights changed');
      const res = MatchEngine.evaluate(JobsStore.jobs()[0], MatchEngine.snapshotFromProfile(ProfileStore.demo(), null));
      ['score', 'factors', 'matched', 'missing', 'filtered', 'breakdown', 'matchReasons']
        .forEach(k => assert(k in res, 'the MatchEngine contract changed: ' + k));
      assert(JobMatchEngine !== MatchEngine, 'JobMatchEngine must be additive, not a replacement');

      /* the sample feed still stands in when nothing has been discovered */
      JobsStore.clear();
      Jobs.reload();
      assert(Jobs.evaluated().length === JobsStore.jobs().length, 'the sample fallback was lost');

      /* discovery writes ONLY the discovered-jobs channel — no other storage is touched */
      const keysBefore = Object.keys(localStorage).sort().join();
      const decisions = JobsStore.load().decisions;
      await Jobs.discover({});
      assert(JSON.stringify(JobsStore.load().decisions) === JSON.stringify(decisions), 'discovery changed the decisions');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'discovery touched the master résumé');
      const keysAfter = Object.keys(localStorage).sort().join();
      assert(keysAfter.indexOf('careerpilot_jobs_v1') !== -1, 'discovery did not publish to the jobs store');
      assert(keysBefore.split(',').every(k => !k || keysAfter.indexOf(k) !== -1), 'discovery removed a storage key');
      return 'SearchEngine + MatchEngine untouched · sample fallback intact · only the discovered-jobs channel is written';
    }],
  ];

  /* Profile.getState() hands back the LIVE in-memory profile. Pin it to the
     shipped defaults for the run (in place, never saved) so the assertions are
     deterministic no matter what the user has entered, then put it back. */
  function pinProfile() {
    const p = Profile.getState();
    const snap = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.demo();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snap);
    };
  }

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const restoreProfile = pinProfile();
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_applications_v1', 'careerpilot_master_resume_v1',
        'careerpilot_platform.resume_overrides', 'careerpilot_platform.cover_letters',
        'careerpilot_platform.application_packages']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      for (const [name, fn] of CASES) {
        try { results.push({ name, pass: true, detail: (await fn()) || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
    } finally {
      restoreProfile();
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
    console.log(`Sprint 25: ${passed}/${results.length} passed`);
    document.title = `Sprint 25 — ${passed}/${results.length} passed`;
  }

  window.addEventListener('load', async () => render(await run()));
})();
