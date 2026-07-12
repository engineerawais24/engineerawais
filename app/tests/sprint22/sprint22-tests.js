/* ============================================================
   Sprint 22 — Cover Letter Generator.
   Browser harness. Snapshots localStorage and restores it, so no
   existing user data is touched. Each case is self-contained: it
   clears the Sprint 22 storage and any résumé override first.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/' + o.id,
      postedDate: '2026-07-08', salary: 150, salaryDisclosed: true, workMode: 'Remote',
      location: 'Remote · US', description: 'x',
    }, o));
  }

  /* an architect role → recommends the Stripe "Sr Solutions Architect" résumé (var1).
     The profile ships with Terraform + Kubernetes but NOT "Cloud migration",
     so exactly 2 of the 3 required skills match. */
  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
  const CONSULT = J({ id: 'j-consult', title: 'Technical Consultant', company: 'Beta',
    skills: ['Client delivery', 'Azure', 'SQL'] });

  const nameOf = id => (ResumeRecommender.candidates().find(c => c.id === id) || {}).name;

  /* every case starts from the same clean slate */
  function reset() {
    CoverLetter.clear();
    ResumeRecommender.clearOverride(ARCH.id);
    ResumeRecommender.clearOverride(CONSULT.id);
    JobsStore.setDiscovered([ARCH, CONSULT]);
    Jobs.reload();
    Jobs.ui.coverOpen = {};
  }

  const CASES = [

    ['1 · Generation', () => {
      reset();
      const l = CoverLetter.generate(ARCH);
      const sel = ResumeRecommender.forJob(ARCH).selected;

      /* built from the job, the profile and the SELECTED résumé */
      assert(l.text.indexOf(ARCH.title) !== -1, 'the letter must name the job title');
      assert(l.text.indexOf(ARCH.company) !== -1, 'the letter must name the company');
      assert(l.text.indexOf('Mohammad Awais') !== -1, 'the letter must sign off with the profile name');
      assert(l.text.indexOf('Karachi') !== -1, 'the letter should use the profile location');
      assert(l.resumeId === sel.id && sel.id === 'var1', 'the letter must be written against the selected résumé, got ' + l.resumeId);
      assert(l.text.indexOf(nameOf('var1')) !== -1, 'the letter must reference the selected résumé by name');

      /* matching skills only — it must never claim a skill the profile lacks */
      assert(l.matchedSkills.join() === 'Terraform,Kubernetes', 'matching skills wrong: ' + l.matchedSkills.join());
      assert(/leads on Terraform, Kubernetes/.test(l.text), 'the letter must lead with the résumé’s matching skills');
      assert(!/leads on[^.]*Cloud migration/.test(l.text), 'the letter claimed a skill that is not on the profile');
      assert(/up to speed on Cloud migration/.test(l.text), 'an unmet requirement should be stated honestly');

      /* the letter is built from the résumé's category and experience, not just the profile */
      assert(l.resumeCategory === 'architect', 'résumé category wrong: ' + l.resumeCategory);
      assert(l.text.indexOf(CoverLetter.CATEGORY_PHRASE.architect) !== -1, 'the letter must reflect the résumé’s category');
      assert(l.evidence.length > 0 && l.text.indexOf(l.evidence[0].text) !== -1, 'the letter must cite the résumé’s experience');

      /* persisted through the existing platform storage — no new system */
      const raw = AppStorage.get(CoverLetter.STORAGE_KEY);
      assert(raw && raw[ARCH.id] && raw[ARCH.id].text === l.text, 'the letter was not persisted via AppStorage');
      assert(localStorage.getItem('careerpilot_platform.' + CoverLetter.STORAGE_KEY) !== null,
        'the letter is not in the platform namespace');
      assert(CoverLetter.get(ARCH.id).text === l.text && CoverLetter.has(ARCH.id), 'the letter is not readable back');

      /* generating for one job does not generate for another */
      assert(!CoverLetter.has(CONSULT.id), 'a letter leaked to another job');

      /* the job card offers Generate before, and the controls after */
      CoverLetter.clear();
      let html = Jobs.render();
      assert(html.indexOf('Jobs.generateCover') !== -1, 'the Generate cover letter button is missing from the card');
      assert(html.indexOf('job-cover') !== -1, 'the cover-letter block is missing from the card');
      Jobs.generateCover(ARCH.id);
      html = Jobs.render();
      ['Jobs.toggleCover', 'Jobs.copyCover', 'Jobs.regenerateCover', 'jc-preview']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the card is missing ' + k + ' after generating'));
      return `${l.text.split('\n').length} lines · résumé ${l.resumeName} · 2/3 skills matched · persisted via AppStorage`;
    }],

    /* The bug this sprint shipped with: the letter DID regenerate, but its body
       was built only from the profile, so every résumé produced the same text.
       These assertions check the RENDERED CARD and the letter's CONTENT — name,
       skills, experience and category — not just the stored resumeId. */
    ['2 · Resume change regeneration', () => {
      reset();
      const first = CoverLetter.generate(ARCH);
      assert(first.resumeId === 'var1', 'expected the recommendation first, got ' + first.resumeId);
      assert(Jobs.render().indexOf('Using <b>' + nameOf('var1')) !== -1, 'the card does not show the résumé it was written with');

      /* changing the résumé on the card regenerates the letter automatically */
      Jobs.setResume(ARCH.id, 'var2');                       // exactly what the dropdown calls
      const after = CoverLetter.get(ARCH.id);
      assert(after.resumeId === 'var2', 'the letter was not regenerated for the new résumé, still ' + after.resumeId);

      /* …name */
      assert(after.text.indexOf(nameOf('var2')) !== -1, 'the regenerated letter does not name the new résumé');
      assert(after.text.indexOf(nameOf('var1')) === -1, 'the regenerated letter still names the old résumé');

      /* …category (var1 is an Architect résumé, var2 an Engineer one) */
      assert(first.resumeCategory === 'architect' && after.resumeCategory === 'engineer',
        'the résumé category did not change: ' + first.resumeCategory + ' → ' + after.resumeCategory);
      assert(after.text.indexOf(CoverLetter.CATEGORY_PHRASE.engineer) !== -1, 'the letter does not use the new résumé’s category');
      assert(after.text.indexOf(CoverLetter.CATEGORY_PHRASE.architect) === -1, 'the letter still uses the old résumé’s category');

      /* …skills: the architect résumé leads on Terraform, the engineer one on Kubernetes */
      assert(first.resumeSkills.join() === 'Terraform,Kubernetes', 'var1 skills wrong: ' + first.resumeSkills.join());
      assert(after.resumeSkills.join() === 'Kubernetes', 'var2 skills wrong: ' + after.resumeSkills.join());
      assert(after.otherSkills.join() === 'Terraform', 'Terraform should drop to a secondary skill for var2');
      assert(/leads on Kubernetes/.test(after.text), 'the letter does not lead on the new résumé’s skills');

      /* …experience: a different résumé puts different bullets first */
      const bulletsBefore = first.evidence.map(e => e.text).join('|');
      const bulletsAfter = after.evidence.map(e => e.text).join('|');
      assert(bulletsBefore !== bulletsAfter, 'the experience bullets did not change with the résumé');
      after.evidence.forEach(e => assert(after.text.indexOf(e.text) !== -1, 'a chosen bullet is missing from the letter'));
      first.evidence.forEach(e => {
        if (bulletsAfter.indexOf(e.text) === -1) assert(after.text.indexOf(e.text) === -1, 'the letter kept an old résumé’s bullet');
      });

      /* …and the body genuinely differs (this is what "stays the same" meant) */
      const diff = after.text.split('\n').filter((l, i) => l !== first.text.split('\n')[i]).length;
      assert(diff >= 3, 'only ' + diff + ' line(s) changed — the letter is still essentially the same');

      /* the card itself updates: the "Using …" label follows the new résumé */
      const html = Jobs.render();
      assert(html.indexOf('Using <b>' + nameOf('var2')) !== -1, 'the “Using …” label did not update');
      assert(html.indexOf('Using <b>' + nameOf('var1')) === -1, 'the card still shows the old résumé');

      /* going back to the recommendation regenerates back */
      Jobs.setResume(ARCH.id, '');
      assert(CoverLetter.get(ARCH.id).resumeId === 'var1', 'clearing the override did not regenerate the letter');
      assert(Jobs.render().indexOf('Using <b>' + nameOf('var1')) !== -1, 'the label did not follow back to the recommendation');

      /* a no-op résumé change must not rewrite the letter */
      const stable = CoverLetter.get(ARCH.id);
      CoverLetter.syncToResume(ARCH);
      Jobs.render();
      assert(CoverLetter.get(ARCH.id).generatedAt === stable.generatedAt, 'the letter was rewritten without a résumé change');

      /* changing the résumé on a job with NO letter must not create one */
      assert(!CoverLetter.has(CONSULT.id), 'precondition: no letter for the second job');
      Jobs.setResume(CONSULT.id, 'var2');
      assert(!CoverLetter.has(CONSULT.id), 'a résumé change generated an unwanted letter');
      assert(CoverLetter.get(ARCH.id).resumeId === 'var1', 'a résumé change on one job affected another');
      return 'name + category + skills + experience all follow the résumé · card label updates · reverts · no-op is a no-op · per-job';
    }],

    /* the card must never show a letter written for a different résumé, even if
       the selection changed by a path that never touched Jobs.setResume */
    ['2b · Stale letter self-heals on render', () => {
      reset();
      CoverLetter.generate(ARCH);
      assert(CoverLetter.get(ARCH.id).resumeId === 'var1', 'precondition failed');

      /* change the selection behind the controller's back */
      ResumeRecommender.setOverride(ARCH.id, 'var3');
      const html = Jobs.render();
      assert(CoverLetter.get(ARCH.id).resumeId === 'var3', 'a stale letter was not rebuilt on render');
      assert(html.indexOf('Using <b>' + nameOf('var3')) !== -1, 'the card rendered a stale résumé label');
      assert(html.indexOf(nameOf('var1')) === -1 || CoverLetter.get(ARCH.id).text.indexOf(nameOf('var1')) === -1,
        'the rendered letter still belongs to the old résumé');
      return 'a letter left over from another résumé is rebuilt before the card shows it';
    }],

    ['3 · Copy', () => {
      reset();
      const l = CoverLetter.generate(ARCH);

      const r = Jobs.copyCover(ARCH.id);
      assert(r && r.ok === true, 'copy failed: ' + (r && r.error));
      assert(r.text === l.text, 'copy returned different text than the stored letter');
      assert(r.text.length > 100, 'the copied text looks truncated (' + r.text.length + ' chars)');
      assert(r.text.indexOf(ARCH.company) !== -1, 'the copied text is not this job’s letter');

      /* copying is read-only — it must not rewrite or drop the letter */
      const still = CoverLetter.get(ARCH.id);
      assert(still.generatedAt === l.generatedAt && still.text === l.text, 'copying mutated the letter');

      /* nothing to copy is reported, not thrown */
      const none = CoverLetter.copy(CONSULT.id);
      assert(none.ok === false && /No cover letter/i.test(none.error), 'copying a missing letter should fail cleanly');
      return `${r.text.length} chars copied · letter unchanged · missing letter fails cleanly`;
    }],

    ['4 · Regenerate', () => {
      reset();
      const first = CoverLetter.generate(ARCH);

      /* template-based: identical inputs → identical body (no AI, no drift) */
      const again = CoverLetter.regenerate(ARCH);
      assert(again.text === first.text, 'regeneration is not deterministic');
      assert(again.generatedAt >= first.generatedAt, 'generatedAt went backwards');

      /* regenerate REPLACES — one letter per job, never appended */
      const all = AppStorage.get(CoverLetter.STORAGE_KEY);
      assert(Object.keys(all).length === 1, 'expected exactly one stored letter, got ' + Object.keys(all).length);

      /* it re-reads the profile, so an edit shows up on the next regenerate */
      const p = Profile.getState();
      const city = p.contact.city;
      try {
        p.contact.city = 'Dubai';
        const updated = Jobs.regenerateCover(ARCH.id);
        assert(updated.text.indexOf('Dubai') !== -1, 'the regenerated letter did not pick up the profile change');
        assert(updated.text.indexOf(city) === -1, 'the regenerated letter still carries the old profile value');
        assert(CoverLetter.get(ARCH.id).text === updated.text, 'the regenerated letter was not persisted');
      } finally {
        p.contact.city = city;
      }

      /* regenerating opens the preview on that card */
      assert(Jobs.ui.coverOpen[ARCH.id] === true, 'regenerate should reveal the preview');
      const html = Jobs.render();
      assert(html.indexOf('jc-preview') !== -1, 'the preview is not rendered on the card');
      Jobs.toggleCover(ARCH.id);
      assert(Jobs.ui.coverOpen[ARCH.id] === false && Jobs.render().indexOf('jc-preview') === -1, 'the preview does not collapse');
      return 'deterministic · replaces in place (1 letter/job) · re-reads the profile · preview opens and collapses';
    }],

    ['5 · Backward compatibility', () => {
      reset();
      Jobs.generateCover(ARCH.id);

      /* the Résumé Library, the locked master and the Approvals-package
         cover letters (ResumesStore.coverLetters) are a different system —
         Sprint 22 must not touch any of them */
      const lib = ResumesStore.load();
      assert(JSON.stringify(lib.variants) === JSON.stringify(ResumesStore.defaults().variants), 'the résumé variants were modified');
      assert(Object.keys(lib.coverLetters).length === 0, 'the Approvals application-package letters were touched');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the master résumé file was touched');

      /* Sprint 20 scoring contract intact */
      const res = MatchEngine.evaluate(ARCH, MatchEngine.snapshotFromProfile(ProfileStore.defaults(), null));
      ['score', 'factors', 'matched', 'missing', 'filtered', 'filterReason', 'breakdown', 'matchReasons']
        .forEach(k => assert(k in res, 'MatchEngine result contract lost: ' + k));

      /* the board still evaluates and decides */
      const items = Jobs.evaluated();
      assert(items.length === 2 && items[0].res && items[0].decision, 'Jobs.evaluated() broke');

      /* a cover letter is a draft — it never decides or submits anything */
      assert(Jobs.statusOf(ARCH.id) === 'pending', 'generating a letter changed the decision');
      assert(DB.approvals.filter(a => a.fromJob === ARCH.id).length === 0, 'generating a letter queued an application');
      Jobs.later(ARCH.id);
      Jobs.regenerateCover(ARCH.id);
      assert(JobsStore.load().decisions[ARCH.id] === 'later', 'regenerating a letter changed a decision');
      assert(JobsStore.load().discovered.length === 2, 'the cover letter changed the stored jobs');

      /* everything the card carried before is still on it */
      const html = Jobs.render();
      ['job-cover', 'job-resume', '% confidence', 'Jobs.setResume', 'job-breakdown', 'MATCH', 'job-search']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the card lost ' + k));
      return 'résumé library + master + package letters untouched · MatchEngine intact · decisions intact · Sprints 19–21 card features preserved';
    }],
  ];

  /* Profile.getState() hands back the LIVE in-memory profile, which was read
     from the user's saved data at page load. Pin it to the shipped defaults
     for the run (in place, never saved) so the assertions are deterministic
     no matter what the user has entered, then put it back exactly. */
  function pinProfile() {
    const p = Profile.getState();
    const snapshot = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.defaults();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snapshot);
    };
  }

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const restoreProfile = pinProfile();
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_master_resume_v1', 'careerpilot_platform.resume_overrides',
        'careerpilot_platform.cover_letters']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      CASES.forEach(([name, fn]) => {
        try { results.push({ name, pass: true, detail: fn() || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      });
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
    console.log(`Sprint 22: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
