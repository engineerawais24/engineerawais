/* ============================================================
   Sprint 29 — Smart Job Match Engine v2.
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

  /* the shipped profile: Terraform, Kubernetes, Python, Client delivery, Azure, SQL
     · AZ-104 · Remote · min $110k · Karachi/Pakistan · targets Solutions Engineer,
     Solutions Architect, Technical Consultant */
  const snap = () => MatchEngineV2.snapshotFromProfile(ProfileStore.demo(), null);

  const CASES = [

    ['1 · Weighted scoring (0–100)', () => {
      const W = MatchEngineV2.WEIGHTS;
      assert(MatchEngineV2.TOTAL === 100, 'the weights must total 100, got ' + MatchEngineV2.TOTAL);
      assert(W.skills === 35 && W.experience === 20 && W.certifications === 15
        && W.location === 10 && W.salary === 10 && W.workMode === 5 && W.title === 5,
        'the weights do not match the specification: ' + JSON.stringify(W));

      const strong = MatchEngineV2.evaluate(J({
        id: 'j-strong', title: 'Senior Solutions Engineer', company: 'Acme',
        skills: ['Terraform', 'Kubernetes', 'Azure'], salary: 160,
      }), snap());
      const weak = MatchEngineV2.evaluate(J({
        id: 'j-weak', title: 'Junior Graphic Designer', company: 'Beta',
        location: 'Berlin · On-site', workMode: 'On-site',
        skills: ['Photoshop', 'Illustrator', 'Typography'], salary: 40,
      }), snap());

      assert(strong.overall >= 85, 'a strong fit should score high, got ' + strong.overall);
      assert(weak.overall <= 35, 'a poor fit should score low, got ' + weak.overall);
      assert(strong.overall > weak.overall, 'the strong job must outrank the weak one');

      /* the parts always add up to the overall, and every part is bounded */
      [strong, weak].forEach(r => {
        const sum = Object.keys(r.parts).reduce((n, k) => n + r.parts[k], 0);
        assert(sum === r.overall, 'the parts do not sum to the overall score: ' + sum + ' vs ' + r.overall);
        assert(r.overall >= 0 && r.overall <= 100, 'the score is out of range: ' + r.overall);
        Object.keys(r.parts).forEach(k =>
          assert(r.parts[k] >= 0 && r.parts[k] <= MatchEngineV2.WEIGHTS[k], 'part out of bounds: ' + k));
      });

      /* deterministic */
      assert(MatchEngineV2.evaluate(J({ id: 'j-strong', title: 'Senior Solutions Engineer', company: 'Acme',
        skills: ['Terraform', 'Kubernetes', 'Azure'], salary: 160 }), snap()).overall === strong.overall,
        'scoring is not deterministic');
      return `strong ${strong.overall} · weak ${weak.overall} · 7 weighted categories totalling 100`;
    }],

    ['2 · Synonym matching', () => {
      const D = SynonymDictionary;

      /* the groups the sprint names */
      ['Cybersecurity', 'Information Security', 'SOC', 'Blue Team']
        .forEach(t => assert(D.sameGroup('Network Security', t), 'not a synonym of Network Security: ' + t));
      ['Physical Security', 'Security Management Platform']
        .forEach(t => assert(D.sameGroup('PSIM', t), 'not a synonym of PSIM: ' + t));
      ['Systems', 'Datacenter']
        .forEach(t => assert(D.sameGroup('Infrastructure', t), 'not a synonym of Infrastructure: ' + t));
      ['Solutions Engineer', 'Solutions Architect']
        .forEach(t => assert(D.sameGroup('Presales', t), 'not a synonym of Presales: ' + t));
      ['Implementation Consultant', 'Professional Services']
        .forEach(t => assert(D.sameGroup('Technical Consultant', t), 'not a synonym of Technical Consultant: ' + t));

      /* it must NOT over-merge */
      assert(!D.sameGroup('Network Security', 'PSIM'), 'two different groups were merged');
      assert(!D.sameGroup('Python', 'PowerShell'), 'different skills must not be synonyms');

      /* the dictionary is configurable, not hardcoded into the engine */
      assert(!D.sameGroup('Zero Trust', 'ZTNA'), 'the custom group should not exist yet');
      D.addGroup({ id: 'zero-trust', canonical: 'Zero Trust', terms: ['zero trust', 'ztna', 'sase'] });
      assert(D.sameGroup('Zero Trust', 'ZTNA') && D.sameGroup('SASE', 'zero trust'), 'addGroup did not take effect');
      assert(D.groups().some(g => g.id === 'zero-trust'), 'the custom group is not registered');

      /* a synonym earns credit in the score: the profile has no "Cybersecurity",
         but the job asking for it is covered by… nothing — so use a term the
         profile DOES hold through a synonym group */
      const m = SkillMatcher.classify('Container orchestration', ['Kubernetes']);
      assert(m.level === 'related', 'a synonym should be a related match, got ' + m.level);
      assert(m.credit === SkillMatcher.CREDIT.related, 'a related match earns the related credit');

      const withSyn = MatchEngineV2.evaluate(J({ id: 'j-syn', title: 'Solutions Engineer', company: 'Acme',
        skills: ['Container orchestration', 'Infrastructure as code'] }), snap());
      assert(withSyn.confidence.related.length === 2, 'the synonyms were not credited: ' + JSON.stringify(withSyn.confidence));
      assert(withSyn.parts.skills > 0, 'a synonym-only match scored zero on skills');
      D.reset();
      assert(!D.sameGroup('Zero Trust', 'ZTNA'), 'reset() did not restore the defaults');
      return 'all five named groups · configurable via addGroup · synonyms score as "related"';
    }],

    ['3 · Certification hierarchy', () => {
      const C = CertHierarchy;

      /* a job asking CCNP accepts CCNP and CCIE — but not CCNA */
      assert(C.satisfies('CCNP', [{ name: 'CCNP' }]).ok, 'CCNP does not satisfy CCNP');
      const higher = C.satisfies('CCNP', [{ name: 'CCIE' }]);
      assert(higher.ok && higher.level === 'higher', 'CCIE should satisfy a CCNP requirement');
      assert(C.satisfies('CCNP', [{ name: 'CCNA' }]).ok === false, 'CCNA must NOT satisfy a CCNP requirement');

      /* a job asking JNCIA accepts every higher Juniper rung */
      ['JNCIA', 'JNCIS', 'JNCIP', 'JNCIE'].forEach(held =>
        assert(C.satisfies('JNCIA', [{ name: held }]).ok, held + ' should satisfy a JNCIA requirement'));
      assert(C.satisfies('JNCIE', [{ name: 'JNCIA' }]).ok === false, 'JNCIA must not satisfy a JNCIE requirement');
      /* and it understands the long-hand spelling */
      assert(C.satisfies('JNCIA', [{ name: 'Juniper Networks Certified Associate – Junos' }]).ok,
        'the vendor long-form was not recognised');

      /* PMP is not rejected when the user holds PMP */
      assert(C.satisfies('PMP', [{ name: 'PMP' }]).ok, 'PMP should satisfy a PMP requirement');
      assert(C.satisfies('PMP', [{ name: 'Project Management Professional (PMP)' }]).ok, 'the PMP long-form was not recognised');
      assert(C.satisfies('PMP', [{ name: 'CAPM' }]).ok === false, 'CAPM must not satisfy a PMP requirement');
      assert(C.satisfies('CAPM', [{ name: 'PMP' }]).ok, 'PMP should satisfy a CAPM requirement (higher proves lower)');

      /* different ladders never cross */
      assert(C.satisfies('CCNP', [{ name: 'JNCIE' }]).ok === false, 'a Juniper cert satisfied a Cisco requirement');

      /* the posting's requirement is read from its own text */
      const job = J({ id: 'j-cert', title: 'Network Engineer', company: 'Acme',
        description: 'You will need a CCNP. Terraform is a plus.', skills: ['Terraform'] });
      const req = C.requiredBy(job);
      assert(req.length === 1 && req[0].key === 'ccnp', 'the required certification was not read: ' + JSON.stringify(req));
      assert(C.requiredBy(J({ id: 'j-none', title: 'Engineer', company: 'A' })).length === 0,
        'a certification was invented for a posting that names none');

      /* it scores: CCIE held against a CCNP requirement earns full marks */
      const withCcie = Object.assign({}, snap(), { certs: ['ccie'] });
      const s = MatchEngineV2.scoreCertifications(job, withCcie);
      assert(s.points === MatchEngineV2.WEIGHTS.certifications, 'a higher certification did not earn full marks');
      assert(s.satisfied[0].level === 'higher', 'the higher certification was not reported as such');
      assert(/exceeds the required/i.test(s.reasons.join(' ')), 'the explanation does not mention the higher cert');

      const withCcna = Object.assign({}, snap(), { certs: ['ccna'] });
      assert(MatchEngineV2.scoreCertifications(job, withCcna).points === 0, 'a lower certification earned marks');

      /* a posting naming no certification cannot cost points */
      assert(MatchEngineV2.scoreCertifications(J({ id: 'x', title: 'Engineer', company: 'A' }), snap()).points
        === MatchEngineV2.WEIGHTS.certifications, 'an unstated requirement cost points');

      /* ladders are configurable */
      C.addLadder({ id: 'custom', vendor: 'Acme', levels: [
        { key: 'acme-1', names: ['acme associate'] }, { key: 'acme-2', names: ['acme expert'] }] });
      assert(C.satisfies('acme associate', [{ name: 'Acme Expert' }]).ok, 'the custom ladder does not work');
      C.reset();
      return 'CCNP←CCIE ✓ CCNP←CCNA ✗ · JNCIA←all Juniper rungs · PMP←PMP ✓ · ladders configurable';
    }],

    ['4 · Skill confidence and grouped gaps', () => {
      const mine = ProfileStore.demo().skills;      // Terraform, Kubernetes, Python, Client delivery, Azure, SQL

      assert(SkillMatcher.classify('Terraform', mine).level === 'exact', 'an exact match was not exact');
      assert(SkillMatcher.classify('K8s', mine).level === 'related', 'a synonym was not related');
      assert(SkillMatcher.classify('PowerShell', mine).level === 'transferable',
        'PowerShell should be transferable from Python');
      assert(SkillMatcher.classify('Typography', mine).level === 'none', 'an unrelated skill was matched');

      /* the credits are ordered, so a better match always scores higher */
      const C = SkillMatcher.CREDIT;
      assert(C.exact > C.related && C.related > C.transferable && C.transferable > C.none,
        'the confidence credits are not ordered');

      const ev = SkillMatcher.evaluate(['Terraform', 'K8s', 'PowerShell', 'Typography'], mine);
      assert(ev.exact.join() === 'Terraform' && ev.related.join() === 'K8s'
        && ev.transferable.join() === 'PowerShell' && ev.missing.join() === 'Typography',
        'the confidences were mis-assigned: ' + JSON.stringify(ev));
      assert(ev.matched.length === 2, 'matched should be the exact + related skills');

      /* requirement 5: missing skills group into a readable theme */
      const groups = SkillMatcher.groupMissing(['Python', 'PowerShell', 'Bash']);
      assert(groups.length === 1 && groups[0].theme === 'Automation',
        'Python/PowerShell/Bash should group as Automation: ' + JSON.stringify(groups));
      assert(groups[0].skills.length === 3, 'the group lost a skill');
      assert(SkillMatcher.describeGaps(['Python', 'PowerShell']).join() === 'Automation (Python, PowerShell)',
        'the gap description is wrong');

      /* an unknown skill still gets a home */
      assert(SkillMatcher.groupMissing(['Typography'])[0].theme === 'Other', 'an unknown gap was dropped');

      /* the engine exposes it all internally, with no UI change */
      const r = MatchEngineV2.evaluate(J({ id: 'j-conf', title: 'Solutions Engineer', company: 'Acme',
        skills: ['Terraform', 'PowerShell', 'Typography'] }), snap());
      assert(r.confidence.exact.length === 1 && r.confidence.transferable.length === 1, 'the confidence is not exposed');
      assert(r.missingGroups.length === 1 && r.missingGroups[0].theme === 'Other', 'the grouped gaps are not exposed');
      return 'exact / related / transferable / none · Python+PowerShell+Bash → "Automation"';
    }],

    ['5 · Salary, location and work mode scoring', () => {
      const s = snap();      // min $110k · Remote preferred · Karachi · Pakistan

      /* salary */
      const above = MatchEngineV2.scoreSalary(J({ id: 'a', title: 'X', company: 'A', salary: 150 }), s);
      const below = MatchEngineV2.scoreSalary(J({ id: 'b', title: 'X', company: 'A', salary: 60 }), s);
      const near = MatchEngineV2.scoreSalary(J({ id: 'c', title: 'X', company: 'A', salary: 100 }), s);
      const undis = MatchEngineV2.scoreSalary(J({ id: 'd', title: 'X', company: 'A', salary: null, salaryDisclosed: false }), s);
      assert(above.points === MatchEngineV2.WEIGHTS.salary, 'a salary above target should earn full marks');
      assert(below.points === 0, 'a salary far below target should earn nothing, got ' + below.points);
      assert(near.points > 0 && near.points < above.points, 'a near-miss salary should score partially');
      assert(undis.points === Math.round(MatchEngineV2.WEIGHTS.salary / 2),
        'an undisclosed salary must score half — never counted against the role');
      assert(/never counted against/i.test(undis.note), 'the undisclosed-salary rule is not explained');
      assert(/Salary within target/.test(above.reasons.join()), 'the salary reason is missing');

      /* location */
      const remote = MatchEngineV2.scoreLocation(J({ id: 'e', title: 'X', company: 'A', workMode: 'Remote', location: 'Remote · US' }), s);
      const dubai = MatchEngineV2.scoreLocation(J({ id: 'f', title: 'X', company: 'A', workMode: 'On-site', location: 'Dubai · On-site' }), s);
      const home = MatchEngineV2.scoreLocation(J({ id: 'g', title: 'X', company: 'A', workMode: 'Hybrid', location: 'Karachi · Hybrid' }), s);
      const away = MatchEngineV2.scoreLocation(J({ id: 'h', title: 'X', company: 'A', workMode: 'On-site', location: 'Tokyo · On-site' }), s);
      assert(remote.points === MatchEngineV2.WEIGHTS.location, 'a remote role should be a full location match');
      assert(dubai.points === MatchEngineV2.WEIGHTS.location, 'Dubai is a preferred location and should score full');
      assert(home.points === MatchEngineV2.WEIGHTS.location, 'the home city should score full');
      assert(away.points === 0, 'an unwanted location should score zero, got ' + away.points);
      assert(away.gapFlag === true, 'the location gap was not flagged');

      /* work mode — the profile prefers Remote */
      const wRemote = MatchEngineV2.scoreWorkMode(J({ id: 'i', title: 'X', company: 'A', workMode: 'Remote' }), s);
      const wHybrid = MatchEngineV2.scoreWorkMode(J({ id: 'j', title: 'X', company: 'A', workMode: 'Hybrid' }), s);
      const wOnsite = MatchEngineV2.scoreWorkMode(J({ id: 'k', title: 'X', company: 'A', workMode: 'On-site' }), s);
      assert(wRemote.points === MatchEngineV2.WEIGHTS.workMode, 'remote should fully satisfy a remote preference');
      assert(wHybrid.points > 0 && wHybrid.points < wRemote.points, 'hybrid should be partially compatible');
      assert(wOnsite.points === 0, 'on-site conflicts with a remote preference and should score zero');
      assert(/compatible/i.test(wRemote.reasons.join()), 'the work-mode reason is missing');

      /* a hybrid-preferring candidate is happy with hybrid */
      const hybridPref = Object.assign({}, s, { workMode: 'Hybrid' });
      assert(MatchEngineV2.scoreWorkMode(J({ id: 'l', title: 'X', company: 'A', workMode: 'Hybrid' }), hybridPref).points
        === MatchEngineV2.WEIGHTS.workMode, 'a matching work mode should score full');
      return 'salary above/near/below/undisclosed · remote, preferred, home, away · remote/hybrid/on-site';
    }],

    ['6 · Title similarity', () => {
      const s = snap();      // targets: Solutions Engineer, Solutions Architect, Technical Consultant

      const exact = MatchEngineV2.scoreTitle(J({ id: 'a', title: 'Solutions Engineer', company: 'A' }), s);
      assert(exact.points === MatchEngineV2.WEIGHTS.title, 'a target role should score full');

      /* a SYNONYM of a target role is a target role */
      const presales = MatchEngineV2.scoreTitle(J({ id: 'b', title: 'Presales Engineer', company: 'A' }), s);
      assert(presales.points === MatchEngineV2.WEIGHTS.title,
        'Presales is a synonym of Solutions Engineer and should score full, got ' + presales.points);
      assert(/target role/i.test(presales.reasons.join()), 'the title reason is missing');

      const consultant = MatchEngineV2.scoreTitle(J({ id: 'c', title: 'Implementation Consultant', company: 'A' }), s);
      assert(consultant.points === MatchEngineV2.WEIGHTS.title, 'Implementation Consultant is a synonym of Technical Consultant');

      const unrelated = MatchEngineV2.scoreTitle(J({ id: 'd', title: 'Graphic Designer', company: 'A' }), s);
      assert(unrelated.points === 0, 'an unrelated title should score zero, got ' + unrelated.points);

      /* seniority is scored by the experience category, not the title */
      const senior = MatchEngineV2.scoreExperience(J({ id: 'e', title: 'Senior Solutions Engineer', company: 'A' }), s);
      const intern = MatchEngineV2.scoreExperience(J({ id: 'f', title: 'Junior Solutions Engineer', company: 'A' }), s);
      assert(senior.points > intern.points, 'seniority is not affecting the experience score');
      assert(senior.jobLevel === 'senior' && intern.jobLevel === 'entry', 'the job level was misread');
      return 'target role ✓ · Presales ≡ Solutions Engineer ✓ · unrelated → 0 · seniority via experience';
    }],

    ['7 · Explanation generation', () => {
      const job = J({
        id: 'j-explain', title: 'Solutions Architect', company: 'Acme',
        location: 'Dubai · Hybrid', workMode: 'Hybrid', salary: 150,
        skills: ['Terraform', 'Kubernetes', 'PSIM'],
        description: 'Physical security platform rollouts. PMP preferred.',
      });
      const withPmp = Object.assign({}, snap(), { certs: ['pmp'] });
      const r = MatchEngineV2.evaluate(job, withPmp);
      const e = r.explanation;

      /* the shape the sprint specifies */
      ['overall', 'skills', 'certifications', 'salary', 'location', 'title', 'reasons']
        .forEach(k => assert(k in e, 'the explanation is missing: ' + k));
      assert(typeof e.overall === 'number' && e.overall >= 0 && e.overall <= 100, 'the overall is not a 0–100 number');
      assert(Array.isArray(e.reasons) && e.reasons.length > 0, 'the explanation has no reasons');

      /* the parts in the explanation are the parts that were scored */
      assert(e.skills === r.parts.skills && e.certifications === r.parts.certifications
        && e.salary === r.parts.salary && e.location === r.parts.location && e.title === r.parts.title,
        'the explanation does not match the score');
      const sum = Object.keys(r.parts).reduce((n, k) => n + r.parts[k], 0);
      assert(sum === e.overall, 'the explanation does not add up to the overall');

      /* the reasons are the ones a human would give */
      const reasons = e.reasons.join(' | ');
      assert(/PMP matches the preferred qualification/i.test(reasons), 'the PMP reason is missing: ' + reasons);
      assert(/Salary within target/i.test(reasons), 'the salary reason is missing: ' + reasons);
      assert(/Dubai/i.test(reasons), 'the location reason is missing: ' + reasons);
      assert(/Terraform|Kubernetes/i.test(reasons), 'the skills reason is missing: ' + reasons);

      /* every factor explains itself too */
      r.factors.forEach(f => ['label', 'points', 'max', 'note', 'gap'].forEach(k =>
        assert(k in f, 'a factor is missing ' + k)));
      assert(r.factors.length === 7, 'expected 7 scoring factors, got ' + r.factors.length);
      return `overall ${e.overall} · ${e.reasons.length} reasons · "${e.reasons[0]}"`;
    }],

    ['8 · Board integration and regression', () => {
      const ARCH = J({ id: 'j-arch', title: 'Senior Solutions Architect', company: 'Acme',
        skills: ['Terraform', 'Kubernetes', 'Cloud migration'] });
      JobsStore.clear();
      JobsStore.setDiscovered([ARCH]);
      Jobs.reload();

      const item = Jobs.evaluated()[0];
      const res = item.res;

      /* the board now scores with v2 */
      assert(res.v2 && typeof res.explanation === 'object', 'v2 is not wired into the board');
      assert(res.score === res.v2.overall, 'the board is not using the v2 score');
      assert(res.breakdown.overall === res.score, 'the breakdown does not match the score');
      const chips = res.breakdown.skills.points + res.breakdown.experience.points
        + res.breakdown.location.points + res.breakdown.salary.points;
      assert(chips === res.score, 'the card chips no longer sum to the score: ' + chips + ' vs ' + res.score);

      /* v1 STILL owns the rules — filtering, region, authorization */
      assert('filtered' in res && 'region' in res && 'filterReason' in res, 'the v1 rule contract was lost');
      assert(res.factors.some(f => f.label === 'Authorization & visa'), 'the authorization factor was dropped — DecisionEngine needs it');
      assert(res.factors.some(f => f.label === 'Role fit'), 'the Role fit factor was dropped — DecisionEngine needs it');
      assert(typeof res.v1Score === 'number', 'the v1 score was not preserved');

      /* MatchEngine v1 itself is untouched */
      const v1 = MatchEngine.evaluate(ARCH, MatchEngine.snapshotFromProfile(ProfileStore.demo(), null));
      assert(Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0) === 100,
        'the v1 weights changed');
      const v1Sum = v1.factors.reduce((n, f) => n + f.points, 0);
      assert(Math.min(100, Math.max(0, v1Sum)) === v1.score, 'the v1 factor contract broke');
      assert(v1.breakdown.overall === v1.score, 'the v1 breakdown broke');

      /* the decision engine still runs, with all its signals */
      assert(item.decision && item.decision.reasons.length, 'DecisionEngine broke');

      /* the UI is unchanged — same chips, same markup */
      const html = Jobs.render();
      ['job-card', 'job-breakdown', 'MATCH', 'job-resume', 'job-cover', 'job-search']
        .forEach(k => assert(html.indexOf(k) !== -1, 'the Today’s Jobs UI changed — lost ' + k));
      assert(html.indexOf('>Skills<') !== -1 && html.indexOf('>Salary<') !== -1, 'the breakdown chips changed');

      /* the whole downstream workflow still works on a v2 score */
      Jobs.approve(ARCH.id);
      const pkg = ApplicationPackages.forJob(ARCH.id);
      assert(pkg && pkg.matchScore === res.score, 'the application package did not take the v2 score');
      assert(CoverLetter.get(ARCH.id), 'the cover letter broke');
      Jobs.undo(ARCH.id);

      /* and no storage schema changed */
      assert(localStorage.getItem('careerpilot_matching_v1') === null, 'v2 invented a storage key');
      return `board scores with v2 (${res.score}) · v1 rules intact · UI unchanged · packages, letters, decisions all work`;
    }],
  ];

  function pinProfile() {
    const p = Profile.getState();
    const snapshot = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.demo();
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
        'careerpilot_applications_v1', 'careerpilot_master_resume_v1', 'careerpilot_documents_v1',
        'careerpilot_platform.resume_overrides', 'careerpilot_platform.cover_letters',
        'careerpilot_platform.application_packages']
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
    console.log(`Sprint 29: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
