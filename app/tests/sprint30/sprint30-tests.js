/* ============================================================
   Sprint 30 — Version 1 Final Stabilization and Release.
   Browser harness. localStorage is snapshotted and restored, so no
   existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/jobs/' + o.id,
      postedDate: '2026-07-08', salary: 150, salaryDisclosed: true, workMode: 'Remote',
      location: 'Remote · US', description: 'A posting.', skills: [],
    }, o));
  }

  const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
    skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });

  /* the personal details that must NEVER reach a real user's profile */
  const DEMO_VALUES = ['TechVantage Systems', 'Netsol Technologies', 'Karachi', 'Pakistan',
    'Citizen', 'Mohammad', 'Awais', 'AZ-104 Azure Administrator',
    '14 PoCs delivered', 'Azure landing zones'];

  function reset() {
    ApplicationPackages.clear();
    CoverLetter.clear();
    ParsedResume.clear();
    ApplicationsStore.clear();
    JobsStore.clear();
    JobsStore.setDiscovered([ARCH]);
    Jobs.reload();
    Applications.reload();
    DB.approvals = [];
  }

  /* put the live profile into a given state, in memory only */
  function setProfile(obj) {
    const p = Profile.getState();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, JSON.parse(JSON.stringify(obj)));
    return p;
  }

  const CASES = [

    ['1 · Demo data isolation', () => {
      /* a FRESH profile carries nobody's personal details */
      const blank = ProfileStore.defaults();
      const json = JSON.stringify(blank);
      DEMO_VALUES.forEach(v =>
        assert(json.indexOf(v) === -1, 'the default profile still contains demo data: ' + v));

      assert(blank.personal.firstName === '' && blank.personal.lastName === '', 'the default profile has a name');
      assert(blank.contact.city === '' && blank.contact.country === '', 'the default profile has a location');
      assert(blank.employment.company === '' && blank.employment.title === '', 'the default profile has an employer');
      assert(blank.authorization.status === '' && blank.authorization.authorizedIn === '',
        'the default profile has a work authorization');
      assert(blank.skills.length === 0 && blank.certifications.length === 0 && blank.history.length === 0,
        'the default profile ships with skills/certifications/history');

      /* the sample profile still exists — but only where it is asked for */
      const demo = ProfileStore.demo();
      assert(demo.employment.company === 'TechVantage Systems', 'the demo profile was lost — the suites need it');
      assert(typeof ProfileStore.demo === 'function', 'demo() must be explicit');

      /* an empty profile produces NO experience — not somebody else's */
      setProfile(ProfileStore.defaults());
      assert(CareerData.experience().length === 0, 'a blank profile still yields sample experience');
      assert(ResumesView.rolesFrom(Profile.getState()).length === 0, 'the résumé preview still falls back to sample roles');

      /* and no cover letter can quote a demo achievement */
      const letter = CoverLetter.generate(ARCH);
      DEMO_VALUES.forEach(v =>
        assert(letter.text.indexOf(v) === -1, 'a blank profile produced a letter containing demo data: ' + v));

      /* the mock job listings the discovery engine needs are NOT demo profile data */
      assert(JobsStore.jobs().length > 0, 'the sample job listings were removed — the discovery engine needs them');
      return 'fresh profile is blank · demo() is explicit · no sample experience, no sample achievements in letters';
    }],

    ['2 · Full profile persistence', () => {
      const mine = ProfileStore.demo();
      mine.personal.firstName = 'Real';
      mine.certifications = [{ name: 'PCNSE', issuer: 'Palo Alto Networks', year: '2021' }];
      setProfile(mine);
      assert(ProfileStore.save(Profile.getState()) === true, 'the profile could not be saved');

      /* it comes back from storage exactly as it went in */
      const back = ProfileStore.load();
      assert(back.personal.firstName === 'Real', 'the name did not persist');
      assert(back.certifications[0].name === 'PCNSE', 'the certifications did not persist');
      assert(back.employment.company === 'TechVantage Systems', 'the employment did not persist');
      assert(back.skills.length === mine.skills.length, 'the skills did not persist');

      /* a saved profile is NEVER backfilled with sample data */
      const partial = { personal: { firstName: 'Solo' } };
      localStorage.setItem(ProfileStore.KEY, JSON.stringify(partial));
      const merged = ProfileStore.load();
      assert(merged.personal.firstName === 'Solo', 'the saved value was lost');
      assert(merged.employment.company === '', 'a missing section was backfilled with demo data: ' + merged.employment.company);
      assert(merged.certifications.length === 0, 'demo certifications were backfilled');
      return 'saved profile round-trips · a partial profile is never topped up with sample data';
    }],

    ['3 · Safe résumé synchronization', () => {
      reset();
      setProfile(ProfileStore.demo());
      const p = Profile.getState();
      p.certifications = [
        { name: 'PCNSE', issuer: 'Palo Alto Networks', year: '2021' },
        { name: 'JNCIA-Junos', issuer: 'Juniper', year: '2022' },
      ];
      p.skills = ['Terraform', 'Juniper'];
      p.history = [{ id: 'mine', company: 'PTCL', title: 'NOC Engineer', startDate: '2016-04', endDate: '2018-12',
        highlights: 'Ran the national backbone NOC.', source: 'manual' }];

      ParsedResume.complete({
        data: {
          personal: { fullName: 'Real User', firstName: 'Real', lastName: 'User', title: 'Cloud Engineer', summary: 'A summary.' },
          contact: { email: 'real@example.com', phone: '', location: '', city: '', country: '' },
          skills: ['Kubernetes', 'Terraform'],
          certifications: [{ name: 'CKA', issuer: 'CNCF', year: '2023' }],
          employment: [{ title: 'Cloud Engineer', company: 'Vercel', startDate: '2021-03', current: true,
            bullets: ['Rebuilt the release pipeline.'], responsibilities: [], achievements: [] }],
          education: [], totalYears: 8, roleKeywords: ['Cloud Engineer'], companies: ['Vercel'], jobTitles: ['Cloud Engineer'],
        },
        missing: [], completeness: 100,
      }, { name: 'resume.docx' });

      ParsedResume.approve(ParsedResume.changedPaths());
      const after = Profile.getState();

      /* additive: nothing the user had is gone */
      ['PCNSE', 'JNCIA-Junos'].forEach(c =>
        assert(after.certifications.some(x => x.name === c), 'an existing certification was deleted: ' + c));
      assert(after.certifications.some(c => /CKA/.test(c.name)), 'the parsed certification was not added');
      ['Terraform', 'Juniper'].forEach(s =>
        assert(after.skills.indexOf(s) !== -1, 'an existing skill was deleted: ' + s));
      assert(after.skills.indexOf('Kubernetes') !== -1, 'the parsed skill was not added');
      const all = [after.employment].concat(after.history);
      assert(all.some(r => r.company === 'PTCL'), 'an existing employment record was deleted');
      assert(all.some(r => /national backbone NOC/.test(r.highlights || '')), 'an existing bullet was deleted');
      assert(after.employment.company === 'Vercel', 'the parsed employer was not applied');

      /* the pre-sync backup exists and holds the profile from BEFORE */
      const b = ParsedResume.latestBackup();
      assert(b && b.profile && b.timestamp, 'no pre-sync backup was written');
      assert(b.profile.certifications.some(c => c.name === 'PCNSE'), 'the backup did not capture the pre-sync profile');
      assert(ParsedResume.backups().length <= ParsedResume.MAX_BACKUPS, 'the backup history is not capped');

      /* nothing outside the sync was touched */
      assert(JSON.stringify(after.authorization) === JSON.stringify(ProfileStore.demo().authorization),
        'the sync modified work authorization');
      assert(JSON.stringify(after.languages) === JSON.stringify(ProfileStore.demo().languages),
        'the sync modified languages');
      return 'certifications, skills and history all merged additively · pre-sync backup taken · unrelated fields untouched';
    }],

    ['4 · Certification recovery', () => {
      reset();
      setProfile(ProfileStore.demo());
      Profile.getState().certifications = [{ name: 'CKA', issuer: 'CNCF', year: '2023' }];

      const docs = ResumesStore.load();
      docs.variants[0].plan = {
        company: 'Stripe', title: 'Sr Solutions Architect',
        ops: { certs: ['Security Vendors: PCNSE — Palo Alto (2021)', 'PMP — PMI (2019)', 'CKA — CNCF (2023)'],
          skills: [], roles: [], summaryText: '', skillsFirst: false, highlights: [] },
        changes: [],
      };
      ResumesStore.save(docs);

      const plan = CertRecovery.preview();
      assert(plan.available, 'the recovery was not offered');
      assert(plan.toRestore.length === 2, 'wrong restore count: ' + plan.toRestore.map(c => c.name).join(', '));
      assert(plan.duplicates.some(d => /CKA/.test(d.found)), 'the duplicate was not skipped');
      assert(JSON.stringify(Profile.getState().certifications).indexOf('PCNSE') === -1, 'the preview wrote to the profile');

      const res = CertRecovery.apply();
      assert(res.ok && res.restored === 2, 'the recovery did not apply: ' + JSON.stringify(res));
      assert(Profile.getState().certifications.length === 3, 'the certifications were not merged');
      assert(Profile.getState().certifications[0].name === 'CKA', 'the existing certification was not kept first');
      return 'preview reads only · 2 restored · 1 duplicate skipped · existing kept';
    }],

    ['5 · Backup export and preview', () => {
      reset();
      setProfile(ProfileStore.demo());
      ProfileStore.save(Profile.getState());

      /* export reads everything CareerPilot owns */
      const data = Backup.exportData();
      assert(data.format === 'careerpilot.backup' && data.version === 1, 'the backup format is wrong');
      assert(data.appVersion === '1.0', 'the backup does not carry the app version');
      assert(data.keyCount > 0 && data.data[ProfileStore.KEY], 'the profile is not in the backup');
      assert(Object.keys(data.data).every(k => k.indexOf('careerpilot_') === 0), 'the backup grabbed a foreign key');
      const json = Backup.exportJson();
      assert(JSON.parse(json).data[ProfileStore.KEY], 'the exported JSON is not parseable');

      /* preview writes NOTHING */
      const before = localStorage.getItem(ProfileStore.KEY);
      const other = JSON.parse(json);
      other.data[ProfileStore.KEY] = JSON.stringify(Object.assign(ProfileStore.demo(), {
        personal: { firstName: 'Someone', lastName: 'Else', headline: '', summary: '' },
      }));
      const plan = Backup.preview(JSON.stringify(other));
      assert(plan.ok, 'the preview failed: ' + plan.error);
      assert(plan.counts.replaced >= 1, 'the preview did not spot the changed profile');
      assert(plan.profile && plan.profile.name === 'Someone Else', 'the preview does not say whose backup it is');
      assert(localStorage.getItem(ProfileStore.KEY) === before, 'the PREVIEW wrote to storage');

      /* a bad file is refused with a readable message */
      assert(Backup.preview('not json').ok === false, 'garbage was accepted');
      assert(/not valid JSON/i.test(Backup.preview('not json').error), 'the message is unclear');
      assert(Backup.preview('{"hello":1}').ok === false, 'a foreign JSON file was accepted');
      assert(/not a CareerPilot backup/i.test(Backup.preview('{"hello":1}').error), 'the message is unclear');
      return `${data.keyCount} keys exported · preview writes nothing · bad files refused with a message`;
    }],

    ['6 · Backup import, confirmation and pre-import backup', () => {
      reset();
      setProfile(ProfileStore.demo());
      Profile.getState().personal.firstName = 'Original';
      ProfileStore.save(Profile.getState());

      const good = Backup.exportData();
      good.data[ProfileStore.KEY] = JSON.stringify(Object.assign(ProfileStore.demo(), {
        personal: { firstName: 'Restored', lastName: 'User', headline: '', summary: '' },
      }));

      /* a restore REFUSES to run without confirmation */
      const refused = Backup.restore(good, {});
      assert(refused.ok === false && /confirmed/i.test(refused.error), 'an unconfirmed restore was allowed');
      assert(ProfileStore.load().personal.firstName === 'Original', 'an unconfirmed restore still wrote');

      /* confirmed: it restores, and backs up the current data first */
      const res = Backup.restore(good, { confirm: true });
      assert(res.ok, 'the restore failed: ' + res.error);
      assert(ProfileStore.load().personal.firstName === 'Restored', 'the backup was not restored');
      assert(res.preImport && res.preImport.data, 'no pre-import backup was taken');
      assert(localStorage.getItem('careerpilot_platform.' + Backup.PRE_IMPORT_KEY) !== null,
        'the pre-import backup is not in storage');

      const saved = JSON.parse(res.preImport.data[ProfileStore.KEY]);
      assert(saved.personal.firstName === 'Original', 'the pre-import backup did not capture the previous data');

      /* …so it can be undone */
      const undo = Backup.undoRestore({ confirm: true });
      assert(undo.ok, 'the undo failed: ' + undo.error);
      assert(ProfileStore.load().personal.firstName === 'Original', 'the undo did not restore the previous profile');
      assert(Backup.undoRestore({}).ok === false, 'an unconfirmed undo was allowed');

      /* a key you have that the file lacks is left alone — a restore never wipes */
      localStorage.setItem('careerpilot_only_mine_v1', 'keep me');
      const partial = { format: 'careerpilot.backup', version: 1, data: { 'careerpilot_profile_v1': good.data[ProfileStore.KEY] } };
      const p2 = Backup.preview(partial);
      assert(p2.untouched.indexOf('careerpilot_only_mine_v1') !== -1, 'the preview did not report the untouched key');
      Backup.restore(partial, { confirm: true });
      assert(localStorage.getItem('careerpilot_only_mine_v1') === 'keep me', 'the restore wiped a key not in the file');
      localStorage.removeItem('careerpilot_only_mine_v1');
      return 'unconfirmed restore refused · pre-import backup taken · undo works · nothing is wiped';
    }],

    ['7 · Weighted job scoring', () => {
      reset();
      setProfile(ProfileStore.demo());
      const snap = MatchEngineV2.snapshotFromProfile(ProfileStore.demo(), null);

      assert(MatchEngineV2.TOTAL === 100, 'the weights do not total 100');
      const r = MatchEngineV2.evaluate(ARCH, snap);
      const sum = Object.keys(r.parts).reduce((n, k) => n + r.parts[k], 0);
      assert(sum === r.overall && r.overall >= 0 && r.overall <= 100, 'the score does not add up');
      assert(r.explanation && r.explanation.reasons.length, 'there is no explanation');

      /* the whole Sprint 29 feature set, still working */
      assert(SynonymDictionary.sameGroup('Network Security', 'SOC'), 'synonyms broke');
      assert(CertHierarchy.satisfies('CCNP', [{ name: 'CCIE' }]).ok, 'the certification hierarchy broke');
      assert(CertHierarchy.satisfies('CCNP', [{ name: 'CCNA' }]).ok === false, 'a lower cert satisfied a higher requirement');
      assert(SkillMatcher.classify('PowerShell', ['Python']).level === 'transferable', 'skill confidence broke');
      assert(SkillMatcher.groupMissing(['Python', 'Bash'])[0].theme === 'Automation', 'gap grouping broke');

      /* the board renders it, and the card chips still sum to the score */
      const item = Jobs.evaluated()[0];
      assert(item.res.score === item.res.v2.overall, 'the board is not using v2');
      const chips = item.res.breakdown.skills.points + item.res.breakdown.experience.points
        + item.res.breakdown.location.points + item.res.breakdown.salary.points;
      assert(chips === item.res.score, 'the card chips do not sum to the score');
      return `overall ${r.overall} · synonyms, ladders, confidence, gaps and explanations all live`;
    }],

    ['8 · Complete application workflow', () => {
      reset();
      setProfile(ProfileStore.demo());

      /* import → review → approve */
      ImportedJobs.clear();
      const imp = ImportedJobs.create({
        url: 'https://boards.greenhouse.io/acme/jobs/9001',
        title: 'Senior Solutions Engineer', company: 'Acme Cloud',
        description: 'Terraform and Kubernetes across cloud migrations. Client delivery matters.',
      });
      assert(imp.ok, 'the import failed');
      assert(ImportedJobs.match(imp.job).percentage >= 0, 'the imported job was not scored');
      Imports.setStatus(imp.job.id, 'approved');
      const impApp = Imports.createApplication(imp.job.id);
      assert(impApp.ok, 'an approved import did not become an application: ' + impApp.error);
      assert(Imports.createApplication(imp.job.id).ok === false, 'a duplicate application was allowed');

      /* discovered job → approve → package */
      Jobs.approve(ARCH.id);
      const pkg = ApplicationPackages.forJob(ARCH.id);
      assert(pkg, 'approving did not create a package');
      assert(pkg.resumeId && pkg.resumeName, 'the package has no résumé recommendation');
      assert(pkg.coverLetter && pkg.coverLetter.length > 100, 'the package has no cover letter');
      assert(typeof pkg.matchScore === 'number', 'the package has no match score');
      assert(pkg.jobSummary, 'the package has no job summary');

      /* checklist → mark applied → board */
      Applications.openPackage(pkg.id);
      const list = ApplicationPackages.checklist(pkg.id);
      assert(list.items.length === 5 && list.complete, 'the checklist did not complete: ' + JSON.stringify(list.progress));
      const before = Applications.counts();
      Applications.markApplied(pkg.id);
      assert(ApplicationPackages.forJob(ARCH.id).status === 'applied', 'the package was not marked applied');
      assert(Applications.counts().applied === before.applied + 1, 'the board/dashboard did not follow');

      /* status workflow → interview */
      Applications.setPackageStatus(pkg.id, 'interview');
      assert(Applications.getItems().find(a => a.jobId === ARCH.id).status === 'interview', 'the board card did not follow');
      assert(Applications.counts().interview === before.interview + 1, 'the counters did not follow');

      /* copy actions */
      assert(Applications.copyPackageCover(pkg.id).ok, 'copy cover letter broke');
      assert(Applications.copyPackageSummary(pkg.id).ok, 'copy summary broke');

      /* interview prep still reads the application memory */
      assert(typeof ApplicationMemory !== 'undefined' && typeof ApplicationMemory.get === 'function',
        'the interview memory (ApplicationMemory) is unavailable');
      assert(ApplicationMemory.get(ARCH.id) === null || typeof ApplicationMemory.get(ARCH.id) === 'object',
        'the interview memory does not answer for this job');
      return 'import → approve → application · discover → approve → package → applied → board → interview';
    }],

    ['9 · Error handling and refresh persistence', () => {
      reset();

      /* missing required profile data is reported clearly */
      setProfile(ProfileStore.defaults());
      const missing = Jobs.missingProfileFields();
      assert(missing.length === 3, 'a blank profile should report 3 missing essentials: ' + missing.join(', '));
      assert(missing.join(' ').indexOf('your name') !== -1, 'the message does not name the missing field');
      setProfile(ProfileStore.demo());
      assert(Jobs.missingProfileFields().length === 0, 'a complete profile should report nothing missing');

      /* a failed parse is reported, never thrown */
      assert(ResumeParser.MESSAGES.unsupported_type && ResumeParser.MESSAGES.empty_file
        && ResumeParser.MESSAGES.unreadable && ResumeParser.MESSAGES.corrupted, 'a parse failure message is missing');

      /* an invalid imported job is refused with per-field messages */
      const bad = ImportedJobs.create({ url: 'not-a-url', title: '', company: '', description: '' });
      assert(bad.ok === false && bad.errors.title && bad.errors.url, 'an invalid import was not reported');

      /* a duplicate application is refused with a message */
      Jobs.approve(ARCH.id);
      const dup = ImportedJobs.createApplication(ARCH.id);
      assert(dup.ok === false && dup.error, 'a duplicate/invalid application had no message');

      /* everything survives a refresh */
      const pkg = ApplicationPackages.forJob(ARCH.id);
      Applications.setPackageStatus(pkg.id, 'applied');
      ProfileStore.save(Profile.getState());
      Applications.reload();
      Jobs.reload();
      assert(ApplicationPackages.forJob(ARCH.id).status === 'applied', 'the package status did not survive');
      assert(CoverLetter.get(ARCH.id), 'the cover letter did not survive');
      assert(ProfileStore.load().employment.company === 'TechVantage Systems', 'the profile did not survive');
      assert(JobsStore.load().decisions[ARCH.id] === 'approved', 'the decision did not survive');
      return 'missing profile data · parse failures · invalid import · duplicate application — all reported · state persists';
    }],

    ['11 · Salary visibility', () => {
      reset();
      const p = setProfile(ProfileStore.demo());   // min $110k/yr · SAR 30,000/mo · AED 25,000/mo

      const YEARLY = J({ id: 'j-usd', title: 'Staff Solutions Architect', company: 'Stripe',
        salary: 185, salaryMax: 215, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year' });
      const MONTHLY = J({ id: 'j-sar', title: 'Solutions Consultant', company: 'stc',
        location: 'Riyadh · On-site', workMode: 'On-site',
        salary: 32000, salaryMax: 40000, salaryDisclosed: true, currency: 'SAR', salaryPeriod: 'month' });
      const LOW = J({ id: 'j-low', title: 'Solutions Engineer', company: 'Beta',
        salary: 60, salaryMax: 80, salaryDisclosed: true, currency: 'USD', salaryPeriod: 'year' });
      const HIDDEN = J({ id: 'j-none', title: 'Solutions Engineer', company: 'Vercel',
        salary: null, salaryMax: null, salaryDisclosed: false });
      const LOW_SAR = J({ id: 'j-sarlow', title: 'Consultant', company: 'Mobily',
        location: 'Riyadh · On-site', workMode: 'On-site',
        salary: 18000, salaryMax: 22000, salaryDisclosed: true, currency: 'SAR', salaryPeriod: 'month' });

      /* --- formatting: the posting's own currency and period, never converted --- */
      assert(PackageBuilder.salaryText(YEARLY) === 'USD 185k–215k/yr', 'yearly format wrong: ' + PackageBuilder.salaryText(YEARLY));
      assert(PackageBuilder.salaryText(MONTHLY) === 'SAR 32,000–40,000/mo', 'monthly format wrong: ' + PackageBuilder.salaryText(MONTHLY));
      assert(PackageBuilder.salaryText(HIDDEN) === 'Salary not disclosed', 'undisclosed format wrong');

      /* --- verdicts --- */
      const y = PackageBuilder.salaryInfo(YEARLY, p);
      assert(y.disclosed && y.status === 'within' && y.label === 'Within target', 'a $215k role should be within a $110k target');
      assert(y.target.text === 'USD 110k/yr', 'the target is not shown in the posting’s own terms: ' + y.target.text);

      const m = PackageBuilder.salaryInfo(MONTHLY, p);
      assert(m.status === 'within', 'SAR 40,000/mo should clear a SAR 30,000/mo target');
      assert(m.target.text === 'SAR 30,000/mo', 'the monthly target is wrong: ' + m.target.text);

      const low = PackageBuilder.salaryInfo(LOW, p);
      assert(low.status === 'below' && low.label === 'Below target', 'an $80k role should be below a $110k target');

      const lowSar = PackageBuilder.salaryInfo(LOW_SAR, p);
      assert(lowSar.status === 'below', 'SAR 22,000/mo should be below a SAR 30,000/mo target');

      const none = PackageBuilder.salaryInfo(HIDDEN, p);
      assert(none.disclosed === false && none.status === 'not_disclosed', 'an undisclosed salary should have no verdict');
      assert(none.target === null, 'an undisclosed salary must not be compared to a target');

      /* no currency conversion: a yearly AED role has no comparable target */
      const AED = J({ id: 'j-aed', title: 'X', company: 'A', salary: 540, salaryMax: 600,
        salaryDisclosed: true, currency: 'AED', salaryPeriod: 'year' });
      const aed = PackageBuilder.salaryInfo(AED, p);
      assert(aed.status === 'no_target' && aed.target === null,
        'a currency with no comparable target must not be judged (no conversion)');
      assert(aed.text === 'AED 540k–600k/yr', 'the AED figure was altered: ' + aed.text);

      /* --- Applications Board card --- */
      JobsStore.setDiscovered([YEARLY, MONTHLY, HIDDEN]);
      Jobs.reload();
      [YEARLY, MONTHLY, HIDDEN].forEach(j => Jobs.approve(j.id));
      const board = Applications.render();
      assert(board.indexOf('USD 185k–215k/yr') !== -1, 'the yearly salary is not on the board card');
      assert(board.indexOf('SAR 32,000–40,000/mo') !== -1, 'the monthly salary is not on the board card');
      assert(board.indexOf('Salary not disclosed') !== -1, 'the undisclosed salary is not stated on the board card');
      assert(board.indexOf('pkg-salary') !== -1, 'the salary has no chip of its own');
      /* it sits with the match score and the status, not buried */
      assert(board.indexOf('pkg-score') !== -1 && board.indexOf('pkg-chip') !== -1, 'the card lost its score/status');

      /* --- Application Package detail --- */
      const pkg = ApplicationPackages.forJob(YEARLY.id);
      Applications.openPackage(pkg.id);
      const detail = Applications.render();
      assert(detail.indexOf('pkg-sal-field') !== -1, 'the package detail has no dedicated salary field');
      assert(detail.indexOf('pkg-sal-amt') !== -1, 'the salary amount is not shown in the detail');
      assert(detail.indexOf('Within target') !== -1, 'the status badge is missing from the detail');
      assert(detail.indexOf('Your minimum: USD 110k/yr') !== -1, 'the user’s target is not shown in the detail');

      /* the frozen job data was not touched */
      assert(pkg.job.salary === 185 && pkg.job.salaryMax === 215 && pkg.job.currency === 'USD',
        'the job salary data was modified');
      return 'USD 185k–215k/yr · SAR 32,000–40,000/mo · Salary not disclosed · within/below/no-target · board + detail';
    }],

    ['12 · Salary entry for imported jobs', () => {
      reset();
      ImportedJobs.clear();
      const p = setProfile(ProfileStore.demo());   // min $110k/yr · SAR 30,000/mo

      const BASE = {
        url: 'https://boards.greenhouse.io/acme/jobs/1', title: 'Solutions Engineer',
        company: 'Acme', description: 'Terraform and Kubernetes work.',
      };

      /* --- SAR monthly, the case that was impossible before --- */
      const sar = ImportedJobs.create(Object.assign({}, BASE, {
        salaryMin: 32000, salaryMax: 40000, currency: 'SAR', salaryPeriod: 'month',
      }));
      assert(sar.ok, 'a SAR monthly salary was rejected: ' + JSON.stringify(sar.errors));
      assert(sar.job.salary === 32000 && sar.job.salaryMax === 40000, 'the SAR figures were not stored');
      assert(sar.job.currency === 'SAR' && sar.job.salaryPeriod === 'month', 'the currency/period were not stored');
      assert(sar.job.salaryDisclosed === true, 'the salary was not marked disclosed');
      assert(PackageBuilder.salaryText(ImportedJobs.toBoardJob(sar.job)) === 'SAR 32,000–40,000/mo',
        'the SAR chip is wrong: ' + PackageBuilder.salaryText(ImportedJobs.toBoardJob(sar.job)));
      const sarInfo = PackageBuilder.salaryInfo(ImportedJobs.toBoardJob(sar.job), p);
      assert(sarInfo.status === 'within', 'SAR 40,000/mo should clear the SAR 30,000/mo target');

      /* --- USD yearly --- */
      const usd = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://boards.greenhouse.io/acme/jobs/2',
        salaryMin: 185, salaryMax: 215, currency: 'USD', salaryPeriod: 'year',
      }));
      assert(usd.ok, 'a USD yearly salary was rejected');
      assert(PackageBuilder.salaryText(ImportedJobs.toBoardJob(usd.job)) === 'USD 185k–215k/yr',
        'the USD chip is wrong');
      assert(PackageBuilder.salaryInfo(ImportedJobs.toBoardJob(usd.job), p).status === 'within',
        'USD 215k should clear the $110k target');

      /* --- below target --- */
      const low = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://boards.greenhouse.io/acme/jobs/3',
        salaryMin: 18000, salaryMax: 22000, currency: 'SAR', salaryPeriod: 'month',
      }));
      assert(PackageBuilder.salaryInfo(ImportedJobs.toBoardJob(low.job), p).status === 'below',
        'SAR 22,000/mo should be below the SAR 30,000/mo target');

      /* --- validation --- */
      const badRange = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://x.example/4', salaryMin: 40000, salaryMax: 30000, currency: 'SAR', salaryPeriod: 'month',
      }));
      assert(badRange.ok === false && badRange.errors.salaryMax, 'a maximum below the minimum was accepted');
      assert(/at least the minimum/i.test(badRange.errors.salaryMax), 'the range message is unclear');

      const noCurrency = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://x.example/5', salaryMin: 32000, currency: '', salaryPeriod: 'month',
      }));
      assert(noCurrency.ok === false && noCurrency.errors.currency, 'a salary without a currency was accepted');

      const noPeriod = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://x.example/6', salaryMin: 32000, currency: 'SAR', salaryPeriod: '',
      }));
      assert(noPeriod.ok === false && noPeriod.errors.salaryPeriod, 'a salary without a period was accepted');

      const maxOnly = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://x.example/7', salaryMax: 40000, currency: 'SAR', salaryPeriod: 'month',
      }));
      assert(maxOnly.ok === false && maxOnly.errors.salary, 'a maximum without a minimum was accepted');

      /* --- undisclosed: fields stored as null, and salary stays optional --- */
      const none = ImportedJobs.create(Object.assign({}, BASE, {
        url: 'https://x.example/8', salaryMin: 32000, currency: 'SAR', salaryPeriod: 'month',
        salaryNotDisclosed: true,
      }));
      assert(none.ok, 'the undisclosed checkbox was rejected');
      assert(none.job.salary === null && none.job.salaryMax === null && none.job.salaryDisclosed === false,
        'an undisclosed salary was still stored: ' + JSON.stringify(none.job.salary));
      assert(PackageBuilder.salaryText(ImportedJobs.toBoardJob(none.job)) === 'Salary not disclosed',
        'the undisclosed chip is wrong');

      const omitted = ImportedJobs.create(Object.assign({}, BASE, { url: 'https://x.example/9' }));
      assert(omitted.ok, 'salary must stay OPTIONAL — an import with no salary was rejected');
      assert(omitted.job.salaryDisclosed === false, 'an omitted salary should be undisclosed');

      /* --- backward compatibility: a job imported before this fix --- */
      const legacy = { id: 'imp-legacy', url: 'https://x.example/old', canonicalUrl: 'x.example/old',
        title: 'Old Job', company: 'Legacy Co', location: '', workplaceType: 'On Site',
        source: 'Imported', description: 'Old import.', salary: 150, currency: 'USD',
        postedDate: null, skills: [], status: 'new', createdAt: Date.now(), createdOn: '2026-07-01' };
      AppStorage.set(ImportedJobs.STORAGE_KEY, ImportedJobs.all().concat([legacy]));
      const read = ImportedJobs.get('imp-legacy');
      assert(read.salaryDisclosed === true, 'an old imported job lost its salary');
      assert(read.salaryPeriod === 'year' && read.currency === 'USD', 'an old salary is not read as USD/year');
      assert(read.salaryMax === null, 'an old job gained a maximum it never had');
      assert(PackageBuilder.salaryText(ImportedJobs.toBoardJob(read)) === 'USD 150k/yr',
        'the legacy chip is wrong: ' + PackageBuilder.salaryText(ImportedJobs.toBoardJob(read)));

      /* --- the salary an import captured reaches its application package --- */
      const target = ImportedJobs.get(sar.job.id);             // the SAR monthly one
      ImportedJobs.setStatus(target.id, 'approved');
      const appRes = ImportedJobs.createApplication(target.id);
      assert(appRes.ok, 'the application was not created');
      const pkg = ApplicationPackages.forJob(target.id);
      assert(pkg.job.salary === 32000 && pkg.job.currency === 'SAR' && pkg.job.salaryPeriod === 'month',
        'the imported salary did not reach the package: ' + JSON.stringify(pkg.job.salary));
      const info = PackageBuilder.salaryInfo(pkg.job, p);
      assert(info.text === 'SAR 32,000–40,000/mo' && info.status === 'within',
        'the package salary chip is wrong: ' + info.text);

      /* the chip is on both screens, and NO editing UI exists anywhere */
      const board = Applications.render();
      assert(board.indexOf('SAR 32,000–40,000/mo') !== -1, 'the salary is not on the Applications package card');
      assert(board.indexOf('editSalary') === -1, 'the Edit salary action is still on the package card');
      assert(board.indexOf('imp-sal-edit') === -1, 'the inline salary editor is still rendered');
      const jobsHtml = Imports.render();
      assert(jobsHtml.indexOf('SAR 32,000–40,000/mo') !== -1, 'the salary is not on the imported job card');
      assert(jobsHtml.indexOf('editSalary') === -1, 'the Edit salary action is still on the imported job card');
      assert(typeof Applications.editSalary === 'undefined' && typeof Imports.editSalary === 'undefined',
        'the salary-edit controller actions still exist');
      assert(typeof ImportedJobs.setSalary === 'undefined'
        && typeof ApplicationPackages.updateJobSalary === 'undefined',
        'the salary-edit logic still exists');
      return 'SAR/mo · USD/yr · range + currency + period validated · undisclosed · legacy jobs · no editing UI';
    }],

    ['10 · Version and no destructive defaults', () => {
      assert(typeof APP_VERSION !== 'undefined' && APP_VERSION === '1.0', 'the app version is not 1.0');

      /* clearing data must be an explicit act, never a side effect */
      setProfile(ProfileStore.demo());
      ProfileStore.save(Profile.getState());
      const before = localStorage.getItem(ProfileStore.KEY);
      Jobs.reload();
      Applications.reload();
      Jobs.render();
      Applications.render();
      assert(localStorage.getItem(ProfileStore.KEY) === before, 'simply rendering the app modified the profile');

      /* the storage keys are the ones v1 shipped — no migration, no renames */
      ['careerpilot_profile_v1', 'careerpilot_jobs_v1', 'careerpilot_applications_v1',
        'careerpilot_documents_v1', 'careerpilot_master_resume_v1']
        .forEach(k => assert(typeof k === 'string', 'key contract broke'));
      assert(ProfileStore.KEY === 'careerpilot_profile_v1', 'the profile storage key changed — that would orphan real data');
      assert(ApplicationsStore.KEY === 'careerpilot_applications_v1', 'the applications key changed');
      assert(ResumesStore.KEY === 'careerpilot_documents_v1', 'the documents key changed');
      assert(MasterResume.KEY === 'careerpilot_master_resume_v1', 'the master résumé key changed');
      return 'version 1.0 · rendering never writes · every storage key unchanged';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const liveProfile = JSON.parse(JSON.stringify(Profile.getState()));
    const results = [];
    try {
      localStorage.clear();
      CASES.forEach(([name, fn]) => {
        try { results.push({ name, pass: true, detail: fn() || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      });
    } finally {
      setProfile(liveProfile);
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
    }
    return results;
  }

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    console.log(`Sprint 30: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
