/* ============================================================
   Sprint 27 — Resume Tailoring and Application Package Builder.
   Browser harness. localStorage is snapshotted and restored, so no
   existing user data is touched. No AI, no network.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/jobs/' + o.id,
      postedDate: '2026-07-08', salary: 150, salaryDisclosed: true, workMode: 'Remote',
      location: 'Remote · US', description: 'A posting.',
    }, o));
  }

  /* an architect role → the Stripe "Sr Solutions Architect" résumé (var1) */
  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
  /* a Datadog role — a company the industry table knows, so the industry
     signal is live rather than "not applicable" */
  const DD = J({ id: 'j-dd', title: 'Technical Consultant', company: 'Datadog',
    location: 'New York · Hybrid', workMode: 'Hybrid',
    skills: ['Client delivery', 'Azure', 'SQL'] });
  /* a posting that names a certification the profile actually holds */
  const CERT = J({ id: 'j-cert', title: 'Cloud Solutions Consultant', company: 'Acme',
    skills: ['Azure', 'Terraform'],
    description: 'Azure landing zones for regulated clients. AZ-104 Azure Administrator required.' });

  const nameOf = id => (ResumeRecommender.candidates().find(c => c.id === id) || {}).name;
  const pkgFor = id => ApplicationPackages.forJob(id);

  function reset() {
    ApplicationPackages.clear();
    CoverLetter.clear();
    ResumeRecommender.clearOverride(ARCH.id);
    ResumeRecommender.clearOverride(DD.id);
    ResumeRecommender.clearOverride(CERT.id);
    ApplicationsStore.clear();
    JobsStore.clear();
    JobsStore.setDiscovered([ARCH, DD, CERT]);
    Jobs.reload();
    Applications.reload();
    Applications.ui.open = {};
    DB.approvals = [];
  }

  const CASES = [

    ['1 · Resume recommendation', () => {
      reset();
      const r = ResumeRecommender.forJob(ARCH);
      assert(r && r.recommended.id === 'var1', 'an architect job should pick the architect résumé, got ' + r.recommended.id);
      assert(r.selected.id === r.recommended.id, 'the selection should default to the recommendation');
      assert(r.all.length === 6, 'the master + 5 variants should all be candidates, got ' + r.all.length);

      /* the percentage and the reason are both there */
      assert(typeof r.recommended.confidence === 'number', 'no recommendation percentage');
      assert(r.recommended.confidence >= 0 && r.recommended.confidence <= 100, 'percentage out of range');
      assert(typeof r.recommended.reason === 'string' && r.recommended.reason.length > 0, 'no recommendation reason');
      assert(/architect/i.test(r.recommended.reason), 'the reason does not explain the match: ' + r.recommended.reason);

      /* it is shown on the job card, unchanged from Sprint 21 */
      const html = Jobs.render();
      assert(html.indexOf('% confidence') !== -1, 'the recommendation percentage is not on the card');
      assert(html.indexOf('job-resume') !== -1, 'the résumé recommendation row is gone');

      /* a manual override still wins, and the recommendation is unaffected */
      Jobs.setResume(ARCH.id, 'var2');
      const o = ResumeRecommender.forJob(ARCH);
      assert(o.selected.id === 'var2' && o.recommended.id === 'var1', 'the manual override broke');
      Jobs.setResume(ARCH.id, '');
      return `var1 recommended at ${r.recommended.confidence}% — "${r.recommended.reason}"`;
    }],

    ['2 · Recommendation scoring', () => {
      reset();
      const W = ResumeRecommender.WEIGHTS;
      const total = Object.keys(W).reduce((n, k) => n + W[k], 0);
      assert(total === 100, 'the weights must total 100, got ' + total);

      /* all five signals the sprint asks for are represented */
      ['skills', 'certifications', 'level', 'category', 'role', 'industry']
        .forEach(k => assert(typeof W[k] === 'number', 'missing scoring signal: ' + k));

      const ranked = ResumeRecommender.rank(ARCH);
      ranked.forEach(r => {
        const sum = Object.keys(r.parts).reduce((n, k) => n + r.parts[k], 0);
        assert(Math.min(100, Math.max(0, sum)) === r.confidence, 'the confidence is not the sum of its parts for ' + r.id);
        ['category', 'skills', 'level', 'role', 'certifications', 'industry']
          .forEach(k => assert(typeof r.parts[k] === 'number', r.id + ' is missing the part: ' + k));
      });

      /* CERTIFICATIONS — the posting names AZ-104, which the profile holds */
      const wanted = ResumeRecommender.certificationsRequiredBy(CERT);
      assert(wanted.length === 1 && /azure administrator/i.test(wanted[0]), 'the required certification was not read: ' + wanted.join());
      const certScored = ResumeRecommender.rank(CERT)[0];
      assert(certScored.certificationsMatched.length === 1, 'the held certification was not credited');
      assert(certScored.parts.certifications === W.certifications, 'a held certification should earn full marks');
      assert(/certifications held/i.test(certScored.reasons.join(' ')), 'the certification is not in the reasons');

      /* a posting that names none cannot penalise you */
      assert(ResumeRecommender.certificationsRequiredBy(ARCH).length === 0, 'a certification was invented for this job');
      assert(ResumeRecommender.rank(ARCH)[0].parts.certifications === W.certifications,
        'an unstated certification requirement must not cost points');

      /* INDUSTRY — Datadog is observability; the Datadog résumé matches it */
      assert(ResumeRecommender.industryOf('Datadog') === 'observability', 'the industry table is wrong');
      assert(ResumeRecommender.industryOf('Stripe') === 'payments', 'the industry table is wrong');
      assert(ResumeRecommender.industryOf('Nowhere Ltd') === null, 'an unknown company must have no industry');

      const dd = ResumeRecommender.rank(DD);
      const ddResume = dd.find(x => x.id === 'var5');     // Datadog — Technical Consultant
      const msResume = dd.find(x => x.id === 'var3');     // Microsoft — Technical Consultant
      assert(ddResume.parts.industry === W.industry, 'the same-industry résumé did not earn the industry points');
      assert(msResume.parts.industry === 0, 'a different-industry résumé should not earn the industry points');
      assert(ddResume.confidence > msResume.confidence, 'industry did not break the tie between two identical résumés');
      assert(dd[0].id === 'var5', 'the Datadog job should now recommend the Datadog résumé, got ' + dd[0].id);
      assert(/observability/i.test(ddResume.reasons.join(' ')), 'the industry match is not explained');

      /* an unrelated résumé still scores far lower, and scoring is deterministic */
      const poor = ResumeRecommender.rank(ARCH).find(r => r.id === 'var4');
      assert(poor.confidence < 50, 'a mismatched résumé should score low, got ' + poor.confidence);
      assert(ResumeRecommender.score(poor, ARCH).confidence === poor.confidence, 'scoring is not deterministic');
      return `weights total 100 · certs ${certScored.parts.certifications}/${W.certifications} · Datadog résumé ${ddResume.confidence}% vs Microsoft ${msResume.confidence}%`;
    }],

    ['3 · Tailored preview generation', () => {
      reset();
      const t = PackageBuilder.tailoringPreview(ARCH);

      /* the profile holds Terraform + Kubernetes but not Cloud migration */
      assert(t.matchedSkills.join() === 'Terraform,Kubernetes', 'matched skills wrong: ' + t.matchedSkills.join());
      assert(t.missingSkills.join() === 'Cloud migration', 'missing skills wrong: ' + t.missingSkills.join());
      assert(Array.isArray(t.suggestedKeywords), 'there are no suggested keywords');
      assert(t.improvements.length > 0, 'there are no suggested improvements');
      assert(t.improvements.some(i => /var|résumé|resume/i.test(i)), 'no résumé-level suggestion');
      assert(t.resume && t.resume.id === 'var1', 'the preview is not written against the selected résumé');

      /* THE RÉSUMÉ IS NOT MODIFIED — the preview is advice, nothing else */
      const libraryBefore = JSON.stringify(ResumesStore.load());
      const profileBefore = JSON.stringify(Profile.getState());
      PackageBuilder.tailoringPreview(ARCH);
      PackageBuilder.tailoringPreview(DD);
      assert(JSON.stringify(ResumesStore.load()) === libraryBefore, 'the tailoring preview modified the résumé library');
      assert(JSON.stringify(Profile.getState()) === profileBefore, 'the tailoring preview modified the profile');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the tailoring preview touched the master résumé');

      /* it shows inside the existing package panel */
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      Applications.openPackage(pkg.id);
      const html = Applications.render();
      assert(html.indexOf('pkg-tailor') !== -1, 'the tailoring preview is not in the package');
      assert(html.indexOf('Terraform') !== -1, 'the matched skills are not shown');
      assert(html.indexOf('Cloud migration') !== -1, 'the missing skills are not shown');
      assert(/YOUR RÉSUMÉ IS NOT MODIFIED/i.test(html), 'the preview does not say the résumé is untouched');
      return `matched ${t.matchedSkills.length} · missing ${t.missingSkills.length} · ${t.suggestedKeywords.length} keyword(s) · ${t.improvements.length} suggestion(s) · nothing written`;
    }],

    ['4 · Cover letter generation', () => {
      reset();
      const letter = CoverLetter.generate(DD);
      const p = ProfileStore.defaults();

      /* V2 uses the company, the title, the location, the experience,
         the certifications and the top matching skills */
      assert(letter.text.indexOf(DD.company) !== -1, 'the company is missing');
      assert(letter.text.indexOf(DD.title) !== -1, 'the job title is missing');
      assert(letter.text.indexOf(DD.location) !== -1, 'the job location is missing');
      assert(letter.text.indexOf('AZ-104 Azure Administrator') !== -1, 'the certification is missing');
      assert(letter.text.indexOf(p.employment.company) !== -1, 'the current employer is missing');
      assert(letter.evidence.length > 0 && letter.text.indexOf(letter.evidence[0].text) !== -1,
        'the experience bullets are missing');
      assert(letter.resumeSkills.length > 0, 'no top matching skills');
      letter.resumeSkills.forEach(s => assert(letter.text.indexOf(s) !== -1, 'a top matching skill is missing: ' + s));

      /* it stays honest: no skill the profile lacks is ever claimed */
      assert(!/leads on[^.]*Workshops/.test(letter.text), 'a skill the profile lacks was claimed');

      /* deterministic and local — no AI, no network */
      assert(CoverLetter.regenerate(DD).text === letter.text, 'the letter is not deterministic');
      assert(letter.text.length > 400, 'the letter looks truncated');

      /* it is the letter the package carries */
      Jobs.approve(DD.id);
      assert(pkgFor(DD.id).coverLetter === letter.text, 'the package letter is not the generated one');
      return `${letter.text.split('\n').length} lines · company, title, location, experience, certification and ${letter.resumeSkills.length} matching skills`;
    }],

    ['5 · Application package creation', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      assert(pkg, 'approving did not create a package');

      /* everything the sprint requires the package to contain */
      assert(pkg.resumeId && pkg.resumeName, 'the selected résumé is missing');
      assert(pkg.coverLetter && pkg.coverLetter.length > 100, 'the cover letter is missing');
      assert(pkg.jobSummary && pkg.jobSummary.length > 20, 'the job summary is missing');
      assert(typeof pkg.matchScore === 'number', 'the match score is missing');
      const list = ApplicationPackages.checklist(pkg.id);
      assert(list.items.length === 5, 'the checklist is missing');

      /* the job summary is built from the job, not invented */
      assert(pkg.jobSummary.indexOf(ARCH.title) !== -1 && pkg.jobSummary.indexOf(ARCH.company) !== -1,
        'the job summary does not describe the job');
      assert(pkg.jobSummary.indexOf('Terraform') !== -1, 'the job summary omits the required skills');

      /* still one package per job, and still on the existing Applications page */
      Jobs.approve(ARCH.id);
      assert(ApplicationPackages.all().length === 1, 'a duplicate package was created');
      assert(Applications.render().indexOf(ARCH.company) !== -1, 'the package is not on the Applications page');
      return `résumé + cover letter + job summary + match ${pkg.matchScore}% + ${list.total}-item checklist`;
    }],

    ['6 · Checklist progress', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);

      /* the five items the sprint names */
      const labels = PackageBuilder.checklist(pkg).items.map(i => i.label);
      assert(labels.join(' | ') === 'Resume selected | Cover letter ready | Job reviewed | Application link verified | Ready to Apply',
        'the checklist items are wrong: ' + labels.join(' | '));

      /* progress moves on its own — nothing to tick by hand */
      let c = ApplicationPackages.checklist(pkg.id);
      assert(c.items.find(i => i.id === 'resume').done === true, 'the résumé item did not tick itself');
      assert(c.items.find(i => i.id === 'cover').done === true, 'the cover letter item did not tick itself');
      assert(c.items.find(i => i.id === 'link').done === true, 'a valid apply link did not tick itself');
      assert(c.items.find(i => i.id === 'reviewed').done === false, 'the job was reviewed before it was opened');
      assert(c.items.find(i => i.id === 'ready').done === false, 'Ready to Apply ticked while an item was outstanding');
      assert(c.done === 3 && c.total === 5 && c.progress === 60, 'the progress is wrong: ' + JSON.stringify(c));

      /* opening the package reviews it, and the last two items follow */
      Applications.openPackage(pkg.id);
      c = ApplicationPackages.checklist(pkg.id);
      assert(c.items.find(i => i.id === 'reviewed').done === true, 'opening the package did not mark it reviewed');
      assert(c.complete === true && c.done === 5 && c.progress === 100, 'the checklist did not complete: ' + JSON.stringify(c));
      assert(ApplicationPackages.get(pkg.id).reviewedAt, 'the review was not persisted');

      /* a package with an unusable link cannot claim a verified link */
      const bad = Object.assign({}, pkg, { job: Object.assign({}, pkg.job, { applyUrl: 'not-a-url' }) });
      const bc = PackageBuilder.checklist(bad);
      assert(bc.items.find(i => i.id === 'link').done === false, 'an invalid apply link was reported as verified');
      assert(bc.items.find(i => i.id === 'ready').done === false, 'Ready to Apply ignored the broken link');
      assert(PackageBuilder.isVerifiableLink('https://example.com/jobs/1') === true, 'a good link was rejected');

      /* the progress is on the page */
      const html = Applications.render();
      assert(html.indexOf('Checklist 5/5') !== -1, 'the checklist progress is not on the card');
      assert(html.indexOf('pkg-check') !== -1, 'the checklist is not in the package panel');
      return '5 items · 3/5 (60%) on creation · 5/5 (100%) once opened · derived, never hand-ticked';
    }],

    ['7 · Copy actions', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);
      Applications.openPackage(pkg.id);

      /* copy the cover letter */
      const cover = Applications.copyPackageCover(pkg.id);
      assert(cover.ok && cover.text === pkgFor(ARCH.id).coverLetter, 'the cover letter copy is wrong');

      /* copy the application summary */
      const sum = Applications.copyPackageSummary(pkg.id);
      assert(sum.ok, 'the summary copy failed: ' + sum.error);
      [ARCH.title, ARCH.company, ARCH.applyUrl, pkg.resumeName, String(pkg.matchScore)]
        .forEach(bit => assert(sum.text.indexOf(bit) !== -1, 'the summary is missing: ' + bit));
      assert(/Checklist \(5\/5/.test(sum.text), 'the summary does not carry the checklist progress');
      assert(sum.text.indexOf('[x] Resume selected') !== -1, 'the summary checklist is not ticked');
      assert(sum.text === ApplicationPackages.summaryText(pkg.id), 'the copied summary is not the package summary');

      /* copying changes nothing */
      const after = pkgFor(ARCH.id);
      assert(after.coverLetter === pkg.coverLetter && after.status === pkg.status, 'copying mutated the package');

      /* both actions are on the card; no PDF/DOCX export is offered */
      const html = Applications.render();
      assert(html.indexOf('Applications.copyPackageCover') !== -1, 'the copy cover letter action is missing');
      assert(html.indexOf('Applications.copyPackageSummary') !== -1, 'the copy summary action is missing');
      assert(!/PDF|DOCX/i.test(html), 'a PDF/DOCX export was offered — not in this sprint');

      /* a missing package fails cleanly */
      assert(ApplicationPackages.copySummary('pkg-nope').ok === false, 'copying a missing package should fail cleanly');
      return `${sum.text.length}-char summary · cover letter copy intact · no PDF/DOCX`;
    }],

    ['8 · Applications Board integration', () => {
      reset();
      Jobs.approve(ARCH.id);
      const pkg = pkgFor(ARCH.id);

      /* the existing board is untouched: four columns, drag and drop, badges */
      const html = Applications.render();
      assert(html.indexOf('kboard') !== -1, 'the board disappeared');
      ApplicationsView.COLS.forEach(c => assert(html.indexOf('>' + c.label + '<') !== -1, 'board column lost: ' + c.label));
      ['Applications.drop', 'Applications.dragStart', 'Applications.setStatus']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the board lost ' + k));

      /* the Sprint 24 workflow still drives the board and the dashboard */
      const base = Applications.counts();
      Applications.setPackageStatus(pkg.id, 'applied');
      assert(Applications.counts().applied === base.applied + 1, 'the dashboard counters did not follow');
      Applications.setPackageStatus(pkg.id, 'interview');
      assert(Applications.getItems().find(a => a.jobId === ARCH.id).status === 'interview', 'the board card did not follow');
      assert(pkgFor(ARCH.id).status === 'interview', 'the package status did not change');

      /* the package keeps everything Sprint 27 added, right through the workflow */
      const after = pkgFor(ARCH.id);
      assert(after.jobSummary && after.reviewedAt !== undefined, 'the Sprint 27 fields were lost in the workflow');
      assert(ApplicationPackages.checklist(after.id).items.length === 5, 'the checklist was lost');
      assert(ApplicationPackages.summaryText(after.id).indexOf('Interview') !== -1, 'the summary does not track the status');

      /* Sprints 22–26 still work */
      assert(CoverLetter.get(ARCH.id), 'the Sprint 22 cover letter was lost');
      assert(typeof JobMatchEngine.score === 'function', 'the Sprint 25 match engine changed');
      assert(typeof ImportedJobs.create === 'function', 'the Sprint 26 import flow changed');
      assert(Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0) === 100,
        'the original MatchEngine changed');
      const jobsHtml = Jobs.render();
      ['job-card', 'MATCH', 'job-resume', 'job-cover', 'job-breakdown']
        .forEach(k => assert(jobsHtml.indexOf(k) !== -1, 'the Today’s Jobs UI changed — lost ' + k));
      return 'board + drag/drop + counters intact · package survives the workflow · Sprints 22–26 intact';
    }],
  ];

  /* Profile.getState() hands back the LIVE in-memory profile. Pin it to the
     shipped defaults for the run (in place, never saved) so the assertions are
     deterministic no matter what the user has entered, then put it back. */
  function pinProfile() {
    const p = Profile.getState();
    const snap = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.defaults();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snap);
    };
  }

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const restoreProfile = pinProfile();
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_applications_v1', 'careerpilot_master_resume_v1', 'careerpilot_documents_v1',
        'careerpilot_platform.resume_overrides', 'careerpilot_platform.cover_letters',
        'careerpilot_platform.application_packages', 'careerpilot_platform.imported_jobs']
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

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    console.log(`Sprint 27: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
