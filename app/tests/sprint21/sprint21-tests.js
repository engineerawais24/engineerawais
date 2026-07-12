/* ============================================================
   Sprint 21 — Resume Recommendation Engine.
   Browser harness. Snapshots localStorage and restores it, so no
   existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* deterministic context: pin the candidate's level so scores don't
     drift with the calendar (evaluate/score are pure given a context) */
  function ctx() {
    return {
      targetRoles: ProfileStore.defaults().preferences.targetRoles,
      level: 'senior',
      years: 7,
    };
  }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/' + o.id,
      postedDate: '2026-07-08', salary: 150, salaryDisclosed: true, workMode: 'Remote',
      location: 'Remote · US', description: 'x',
    }, o));
  }

  /* an architect role → the Stripe "Sr Solutions Architect" résumé */
  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
  /* a consultant role → the Microsoft "Technical Consultant" résumé */
  const CONSULT = J({ id: 'j-consult', title: 'Technical Consultant', company: 'Beta',
    skills: ['Client delivery', 'Azure', 'SQL'] });

  const CASES = [

    ['1 · Resume selection', () => {
      const c = ctx();
      const a = ResumeRecommender.recommend(ARCH, c);
      assert(a && a.id === 'var1', 'architect job should pick the Sr Solutions Architect résumé, got ' + (a && a.id));
      assert(/Architect/i.test(a.name), 'recommended résumé name looks wrong: ' + a.name);

      const b = ResumeRecommender.recommend(CONSULT, c);
      assert(b && b.id === 'var3', 'consultant job should pick a Technical Consultant résumé, got ' + (b && b.id));

      // every résumé is a candidate: the locked master + each variant
      const all = ResumeRecommender.candidates();
      assert(all.length === 6, 'expected master + 5 variants, got ' + all.length);
      assert(all[0].id === 'master' && all[0].isMaster === true, 'the master résumé must be a candidate');

      // deterministic: identical résumés tie-break stably (var3 before var5)
      const ranked = ResumeRecommender.rank(CONSULT, c);
      const tie = ranked.filter(r => r.confidence === ranked[0].confidence).map(r => r.id);
      assert(tie[0] === 'var3', 'tie-break is not deterministic: ' + tie.join());
      assert(ResumeRecommender.rank(CONSULT, c).map(r => r.id).join() === ranked.map(r => r.id).join(), 'ranking is not stable');
      return 'architect job → var1 · consultant job → var3 · master + 5 variants ranked, stable tie-break';
    }],

    ['2 · Confidence calculation', () => {
      const c = ctx();
      const ranked = ResumeRecommender.rank(ARCH, c);
      ranked.forEach(r => {
        assert(typeof r.confidence === 'number', 'confidence must be a number');
        assert(r.confidence >= 0 && r.confidence <= 100, 'confidence out of range: ' + r.confidence);
        /* sums EVERY signal, so the assertion keeps holding as the engine
           grows (Sprint 27 added certifications + industry) */
        const sum = Object.keys(r.parts).reduce((n, k) => n + r.parts[k], 0);
        assert(Math.min(100, Math.max(0, sum)) === r.confidence, 'confidence is not the sum of its parts for ' + r.id);
      });

      const total = Object.keys(ResumeRecommender.WEIGHTS)
        .reduce((n, k) => n + ResumeRecommender.WEIGHTS[k], 0);
      assert(total === 100, 'weights must sum to 100, got ' + total);

      const best = ranked[0];
      assert(best.id === 'var1' && best.confidence === 100, 'a perfect résumé fit should be 100%, got ' + best.confidence);

      // a poor fit must score much lower
      const poor = ranked.find(r => r.id === 'var4');
      assert(poor.confidence < 50, 'a mismatched résumé should score low, got ' + poor.confidence);
      assert(best.confidence > poor.confidence, 'the best résumé must outrank a poor one');

      // deterministic
      assert(ResumeRecommender.score(best, ARCH, c).confidence === best.confidence, 'scoring is not deterministic');
      return `var1 100% · var4 ${poor.confidence}% · parts sum correctly · weights total 100`;
    }],

    ['3 · Manual override', () => {
      ResumeRecommender.clearOverride(ARCH.id);
      let r = ResumeRecommender.forJob(ARCH);
      assert(r.overridden === false, 'should start on the recommendation');
      assert(r.selected.id === r.recommended.id, 'selected must default to the recommendation');

      // override to a different résumé
      ResumeRecommender.setOverride(ARCH.id, 'var2');
      r = ResumeRecommender.forJob(ARCH);
      assert(r.overridden === true, 'override not applied');
      assert(r.selected.id === 'var2', 'selected résumé should be the override, got ' + r.selected.id);
      assert(r.recommended.id === 'var1', 'the recommendation must not change when overridden');
      assert(typeof r.selected.confidence === 'number', 'the overridden résumé must still be scored');

      // persisted through the existing platform storage
      assert(ResumeRecommender.overrideFor(ARCH.id) === 'var2', 'override not readable');
      const raw = AppStorage.get(ResumeRecommender.STORAGE_KEY);
      assert(raw && raw[ARCH.id] === 'var2', 'override not persisted via AppStorage');
      assert(localStorage.getItem('careerpilot_platform.' + ResumeRecommender.STORAGE_KEY) !== null,
        'override not stored in the platform namespace');

      // overriding one job must not affect another
      assert(ResumeRecommender.forJob(CONSULT).overridden === false, 'override leaked to another job');

      // clearing returns to the recommendation
      ResumeRecommender.clearOverride(ARCH.id);
      r = ResumeRecommender.forJob(ARCH);
      assert(r.overridden === false && r.selected.id === 'var1', 'clearing the override did not restore the recommendation');

      // Jobs.setResume drives the same path, and picking the recommended
      // résumé again simply clears the override
      JobsStore.setDiscovered([ARCH, CONSULT]);
      Jobs.reload();
      Jobs.setResume(ARCH.id, 'var3');
      assert(ResumeRecommender.overrideFor(ARCH.id) === 'var3', 'Jobs.setResume did not set the override');
      Jobs.setResume(ARCH.id, 'var1');   // the recommended one
      assert(ResumeRecommender.overrideFor(ARCH.id) === null, 're-picking the recommendation should clear the override');
      return 'override applies, is scored, persists via AppStorage, is per-job, and clears back to the recommendation';
    }],

    ['4 · Recommendation reasons', () => {
      const c = ctx();
      const best = ResumeRecommender.recommend(ARCH, c);
      assert(Array.isArray(best.reasons) && best.reasons.length > 0, 'reasons must be a non-empty array');
      assert(typeof best.reason === 'string' && best.reason.length > 0, 'reason must be a non-empty string');
      assert(best.reason.split(' · ').length <= 2, 'the short reason must be 1–2 parts, got: ' + best.reason);
      assert(/architect/i.test(best.reason), 'the reason should mention the matched category: ' + best.reason);
      assert(/3\/3/.test(best.reasons.join(' ')), 'the reasons should report the skill coverage: ' + best.reasons.join(' · '));
      assert(best.matchedSkills.length === 3, 'matchedSkills wrong');

      // a poor fit explains itself honestly rather than claiming a match
      const poor = ResumeRecommender.rank(ARCH, c).find(r => r.id === 'var4');
      assert(!/matches this/i.test(poor.reason), 'a mismatched résumé must not claim a category match: ' + poor.reason);
      assert(/0\/3/.test(poor.reasons.join(' ')), 'a mismatched résumé should report 0/3 skills: ' + poor.reasons.join(' · '));
      return `"${best.reason}"`;
    }],

    ['5 · Backward compatibility', () => {
      // the Résumé Library and the master résumé are untouched
      const before = JSON.stringify(ResumesStore.load().variants);
      ResumeRecommender.setOverride(ARCH.id, 'var2');
      ResumeRecommender.recommend(ARCH, ctx());
      assert(JSON.stringify(ResumesStore.load().variants) === before, 'the résumé variants were modified');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the master résumé file was touched');

      // Sprint 20 scoring is unchanged
      const total = Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0);
      assert(total === 100, 'MatchEngine weights changed');
      const res = MatchEngine.evaluate(ARCH, MatchEngine.snapshotFromProfile(ProfileStore.defaults(), null));
      ['score', 'factors', 'matched', 'missing', 'filtered', 'filterReason', 'breakdown', 'matchReasons']
        .forEach(k => assert(k in res, 'MatchEngine result contract lost: ' + k));

      // the board still evaluates, decides and renders
      JobsStore.setDiscovered([ARCH, CONSULT]);
      Jobs.reload();
      const items = Jobs.evaluated();
      assert(items.length === 2 && items[0].res && items[0].decision, 'Jobs.evaluated() broke');

      // decisions are unaffected by a résumé override
      Jobs.later(ARCH.id);
      ResumeRecommender.setOverride(ARCH.id, 'var3');
      assert(JobsStore.load().decisions[ARCH.id] === 'later', 'a résumé override changed a decision');
      assert(JobsStore.load().discovered.length === 2, 'a résumé override changed the stored jobs');

      // the card shows the recommendation, and everything before it survives
      const html = Jobs.render();
      assert(html.indexOf('job-resume') !== -1, 'résumé recommendation missing from the card');
      assert(html.indexOf('% confidence') !== -1, 'confidence missing from the card');
      assert(html.indexOf('Jobs.setResume') !== -1, 'the manual override control is missing');
      assert(html.indexOf('job-breakdown') !== -1, 'Sprint 20 score breakdown disappeared');
      assert(html.indexOf('MATCH') !== -1, 'the existing match score area disappeared');
      assert(html.indexOf('job-search') !== -1, 'Sprint 19 board toolbar disappeared');

      ResumeRecommender.clearOverride(ARCH.id);
      return 'résumé library + master untouched, MatchEngine intact, decisions intact, card keeps Sprints 19–20';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_master_resume_v1', 'careerpilot_platform.resume_overrides']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
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
    console.log(`Sprint 21: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
