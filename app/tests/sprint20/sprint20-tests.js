/* ============================================================
   Sprint 20 — Job Match Scoring Improvements.
   Browser harness. Snapshots localStorage and restores it, so no
   existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* deterministic snapshot: pin the candidate's level/years so evaluate()
     is fully reproducible regardless of the day the tests are run */
  function snap() {
    const s = MatchEngine.snapshotFromProfile(ProfileStore.defaults(), null);
    s.years = 7;
    s.level = 'senior';
    return s;
  }

  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      employmentType: 'Full-time', applyUrl: 'https://example.com/' + o.id,
      postedDate: '2026-07-08', languagesRequired: [],
    }, o));
  }

  /* STRONG: senior engineer, all skills, remote+preferred location, pays well */
  const STRONG = J({
    id: 'j-strong', title: 'Senior Solutions Engineer', company: 'Acme',
    location: 'Remote · US', workMode: 'Remote',
    skills: ['Terraform', 'Kubernetes', 'Azure'],
    salary: 150, salaryMax: 180, salaryDisclosed: true, visaSponsorship: true,
    description: 'Own technical delivery end to end.',
  });
  /* MID: right family, half the skills, GCC on-site, salary undisclosed */
  const MID = J({
    id: 'j-mid', title: 'Solutions Engineer', company: 'Beta',
    location: 'Dubai · On-site', workMode: 'On-site',
    skills: ['Terraform', 'Docker'],
    salaryDisclosed: false, visaSponsorship: true,
    description: 'Deliver integrations in the Gulf.',
  });
  /* WEAK: wrong family, no skills, filtered by BOTH salary and region */
  const WEAK = J({
    id: 'j-weak', title: 'Junior Marketing Associate', company: 'Cygnus',
    location: 'London · On-site', workMode: 'On-site',
    skills: ['Photoshop', 'SEO'],
    salary: 60, salaryDisclosed: true, visaSponsorship: false,
    description: 'Run campaigns.',
  });
  /* REGION-only filter: good salary, but outside GCC with no sponsorship */
  const REGION = J({
    id: 'j-region', title: 'Solutions Engineer', company: 'Delta',
    location: 'London · On-site', workMode: 'On-site',
    skills: ['Terraform'],
    salary: 150, salaryDisclosed: true, visaSponsorship: false,
    description: 'On-site only.',
  });

  const CASES = [

    ['1 · Score calculation', () => {
      const s = snap();
      const strong = MatchEngine.evaluate(STRONG, s);
      const mid = MatchEngine.evaluate(MID, s);
      const weak = MatchEngine.evaluate(WEAK, s);

      [strong, mid, weak].forEach(r => {
        assert(typeof r.score === 'number', 'score must be a number');
        assert(r.score >= 0 && r.score <= 100, 'score out of range: ' + r.score);
        const sum = r.factors.reduce((n, f) => n + f.points, 0);
        assert(Math.min(100, Math.max(0, sum)) === r.score, 'score is not the sum of its factors');
        r.factors.forEach(f => assert(f.points <= f.max && f.points >= 0, 'factor out of bounds: ' + f.label));
      });

      // deterministic: same inputs → same score
      assert(MatchEngine.evaluate(STRONG, snap()).score === strong.score, 'scoring is not deterministic');

      // the six signals actually move the score
      assert(strong.score >= 85, 'a perfect-fit job should score high, got ' + strong.score);
      assert(weak.score <= 30, 'a poor-fit job should score low, got ' + weak.score);
      assert(mid.score > weak.score && mid.score < strong.score, 'mid job should sit between, got ' + mid.score);
      return `strong ${strong.score} · mid ${mid.score} · weak ${weak.score} · sums match, deterministic`;
    }],

    ['2 · Ranking order', () => {
      const s = snap();
      const items = [WEAK, MID, STRONG].map(j => ({ job: j, res: MatchEngine.evaluate(j, s) }));
      const ranked = items.slice().sort((a, b) => b.res.score - a.res.score);
      assert(ranked.map(x => x.job.id).join() === 'j-strong,j-mid,j-weak', 'ranking order wrong: ' + ranked.map(x => x.job.id).join());

      // seniority: an entry-level title ranks below a matching senior title
      const entry = J({ id: 'j-entry', title: 'Junior Solutions Engineer', company: 'Acme',
        location: 'Remote · US', workMode: 'Remote', skills: ['Terraform', 'Kubernetes', 'Azure'],
        salary: 150, salaryMax: 180, salaryDisclosed: true, description: 'x' });
      const eRes = MatchEngine.evaluate(entry, s);
      const sRes = MatchEngine.evaluate(STRONG, s);
      assert(eRes.score < sRes.score, 'a mismatched seniority level should score lower');
      assert(eRes.breakdown.experience.points < sRes.breakdown.experience.points, 'experience level must affect the experience score');
      return 'strong > mid > weak; senior-level match outranks an otherwise identical junior title';
    }],

    ['3 · Breakdown values', () => {
      const r = MatchEngine.evaluate(STRONG, snap());
      const b = r.breakdown;
      assert(b, 'breakdown missing');
      ['overall', 'skills', 'experience', 'location', 'salary'].forEach(k => assert(k in b, 'breakdown missing: ' + k));
      assert(b.overall === r.score, 'breakdown.overall must equal the score');

      const byLabel = l => r.factors.find(f => f.label === l).points;
      assert(b.skills.points === byLabel('Skills & certifications'), 'skills breakdown does not match its factor');
      assert(b.experience.points === byLabel('Experience relevance'), 'experience breakdown does not match its factor');
      assert(b.location.points === byLabel('Location & work mode'), 'location breakdown does not match its factor');
      assert(b.salary.points === byLabel('Salary alignment'), 'salary breakdown does not match its factor');

      assert(b.skills.max === MatchEngine.WEIGHTS.skills, 'skills max wrong');
      assert(b.experience.max === MatchEngine.WEIGHTS.experience, 'experience max wrong');
      assert(b.location.max === MatchEngine.WEIGHTS.location, 'location max wrong');
      assert(b.salary.max === MatchEngine.WEIGHTS.salary, 'salary max wrong');
      ['skills', 'experience', 'location', 'salary'].forEach(k =>
        assert(b[k].points >= 0 && b[k].points <= b[k].max, k + ' points out of bounds'));

      // an undisclosed salary still produces a (half) salary score, never a filter
      const midB = MatchEngine.evaluate(MID, snap()).breakdown;
      assert(midB.salary.points === Math.round(MatchEngine.WEIGHTS.salary / 2), 'undisclosed salary should score half');
      return `skills ${b.skills.points}/${b.skills.max} · exp ${b.experience.points}/${b.experience.max} · loc ${b.location.points}/${b.location.max} · sal ${b.salary.points}/${b.salary.max}`;
    }],

    ['4 · Match reasons', () => {
      const r = MatchEngine.evaluate(STRONG, snap());
      assert(Array.isArray(r.matchReasons), 'matchReasons must be an array');
      assert(r.matchReasons.length > 0 && r.matchReasons.length <= 5, 'expected 1–5 reasons, got ' + r.matchReasons.length);
      ['Strong skill match', 'Preferred location', 'Salary meets expectation', 'Remote matches preference', 'Resume category matched']
        .forEach(x => assert(r.matchReasons.indexOf(x) !== -1, 'missing reason: ' + x));

      // a poor job must not claim positive reasons it hasn't earned
      const w = MatchEngine.evaluate(WEAK, snap());
      assert(w.matchReasons.indexOf('Strong skill match') === -1, 'weak job must not claim a strong skill match');
      assert(w.matchReasons.indexOf('Salary meets expectation') === -1, 'below-minimum salary must not claim it meets expectation');
      assert(w.matchReasons.length <= 5, 'reasons must be capped at 5');
      return `5 reasons on the strong job: ${r.matchReasons.join(' · ')}`;
    }],

    ['5 · Backward compatibility', () => {
      const s = snap();
      const r = MatchEngine.evaluate(STRONG, s);

      // the Sprint 8A result contract is intact
      ['score', 'factors', 'matched', 'missing', 'filtered', 'filterReason', 'region', 'reasons', 'gaps']
        .forEach(k => assert(k in r, 'result contract lost: ' + k));
      r.factors.forEach(f => ['label', 'points', 'max', 'note', 'gap'].forEach(k => assert(k in f, 'factor contract lost: ' + k)));
      assert(Array.isArray(r.matched) && Array.isArray(r.missing), 'matched/missing must be arrays');
      assert(r.matched.length === 3 && r.missing.length === 0, 'matched/missing wrong for the strong job');

      // weights still sum to 100
      const total = Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0);
      assert(total === 100, 'weights must sum to 100, got ' + total);

      // SALARY RULES unchanged
      assert(MatchEngine.evaluate(MID, s).filtered === false, 'an undisclosed salary must NEVER be filtered');
      const w = MatchEngine.evaluate(WEAK, s);
      assert(w.filtered === true && w.filterReason === 'salary', 'a below-minimum disclosed salary must be filtered');

      // GCC REGION RULES unchanged
      const reg = MatchEngine.evaluate(REGION, s);
      assert(reg.filtered === true && reg.filterReason === 'region', 'outside-GCC on-site without sponsorship must be region-filtered');
      assert(MatchEngine.evaluate(STRONG, s).region.filtered === false, 'a remote job must never be region-filtered');

      // downstream engines still consume the result
      const rank = RankEngine.rank(STRONG, r, CompaniesStore.load());
      assert(rank && typeof rank.rankScore === 'number', 'RankEngine broke');
      const dec = DecisionEngine.decide(STRONG, r, rank, s);
      assert(dec && dec.outcome && Array.isArray(dec.reasons), 'DecisionEngine broke');

      // the board still evaluates and renders
      JobsStore.setDiscovered([STRONG, MID, WEAK]);
      Jobs.reload();
      const items = Jobs.evaluated();
      assert(items.length === 3 && items[0].res && items[0].decision, 'Jobs.evaluated() broke');
      const html = Jobs.render();
      assert(html.indexOf('job-breakdown') !== -1, 'score breakdown missing from the card');
      assert(html.indexOf('job-reasons') !== -1, 'match reasons missing from the card');
      assert(html.indexOf('MATCH') !== -1, 'the existing match score area was removed');

      // an older result object (no breakdown) must still render
      const legacy = Object.assign({}, r);
      delete legacy.breakdown; delete legacy.matchReasons;
      const legacyItems = [{ job: STRONG, res: legacy, rank: null, decision: null, status: 'pending' }];
      const legacyHtml = JobsView.render({ items: legacyItems, ui: Jobs.ui, minSalary: 110, summaryHtml: '' });
      assert(legacyHtml.indexOf('job-breakdown') === -1, 'a legacy result must not render a breakdown');
      assert(legacyHtml.length > 100, 'a legacy result must still render the card');
      return 'result contract, weights, salary rules, GCC rules, RankEngine, DecisionEngine and the board all intact';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1'].forEach(k => {
        try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
      });
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
    console.log(`Sprint 20: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
