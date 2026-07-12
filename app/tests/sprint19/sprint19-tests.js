/* ============================================================
   Sprint 19 — Advanced Search, Filters and Saved Searches.
   Browser harness. Snapshots localStorage and restores it in a
   finally block, so no existing user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  const ids = list => list.map(x => (x.job ? x.job : x).id);

  /* ---- fixtures ---- */
  function J(o) {
    return JobSchema.normalized(Object.assign({
      source: 'LinkedIn', sourceJobId: o.id, currency: 'USD', salaryPeriod: 'year',
      description: '', applyUrl: 'https://example.com/' + o.id, employmentType: 'Full-time',
    }, o));
  }
  function fixtures() {
    return [
      J({ id: 'j-a', title: 'Senior Solutions Architect', company: 'Acme', location: 'Riyadh · On-site',
        workMode: 'On-site', skills: ['Terraform', 'Azure'], salary: 120, salaryMax: 150, salaryDisclosed: true,
        postedDate: '2026-07-10', employmentType: 'Full-time' }),                       // usdK 150 · senior · architect
      J({ id: 'j-b', title: 'Solutions Engineer', company: 'Beta', location: 'Dubai · Hybrid',
        workMode: 'Hybrid', skills: ['Python', 'Kubernetes'], salary: 90, salaryDisclosed: true,
        postedDate: '2026-07-01', employmentType: 'Contract' }),                        // usdK 90 · mid · engineer
      J({ id: 'j-c', title: 'Technical Consultant', company: 'Cygnus', location: 'Riyadh · On-site',
        workMode: 'On-site', skills: ['SQL'], salary: 30000, salaryDisclosed: true, currency: 'SAR',
        salaryPeriod: 'month', postedDate: '2026-07-05', employmentType: 'Full-time' }), // usdK ~95.98 · mid · consultant
      J({ id: 'j-d', title: 'Junior Implementation Engineer', company: 'Delta', location: 'Remote · US',
        workMode: 'Remote', skills: ['JavaScript'], salaryDisclosed: false,
        postedDate: '2026-07-08', employmentType: 'Full-time' }),                       // undisclosed · entry · implementation
    ];
  }

  const CASES = [

    ['1 · Keyword search (title, company, location, skills)', () => {
      const jobs = fixtures();
      assert(ids(JobFilters.apply(jobs, { search: 'architect' })).join() === 'j-a', 'title search failed');
      assert(ids(JobFilters.apply(jobs, { search: 'acme' })).join() === 'j-a', 'company search failed');
      assert(ids(JobFilters.apply(jobs, { search: 'riyadh' })).join() === 'j-a,j-c', 'location search failed');
      assert(ids(JobFilters.apply(jobs, { search: 'kubernetes' })).join() === 'j-b', 'skills search failed');
      assert(JobFilters.apply(jobs, { search: '' }).length === 4, 'empty search must return everything');
      assert(JobFilters.apply(jobs, { search: 'zzz' }).length === 0, 'no-match search must return nothing');
      return 'title / company / location / skills all searchable; empty search returns all';
    }],

    ['2 · Search is case-insensitive', () => {
      const jobs = fixtures();
      ['acme', 'ACME', 'AcMe', 'aCmE'].forEach(q =>
        assert(ids(JobFilters.apply(jobs, { search: q })).join() === 'j-a', 'case-insensitive failed for: ' + q));
      assert(ids(JobFilters.apply(jobs, { search: 'KUBERNETES' })).join() === 'j-b', 'uppercase skill search failed');
      assert(ids(JobFilters.apply(jobs, { search: 'RiYaDh' })).join() === 'j-a,j-c', 'mixed-case location search failed');
      return 'acme / ACME / AcMe / aCmE all match the same job';
    }],

    ['3 · Combined filters work together', () => {
      const jobs = fixtures();
      assert(ids(JobFilters.apply(jobs, { remote: true })).join() === 'j-d', 'remote filter failed');
      assert(ids(JobFilters.apply(jobs, { hybrid: true })).join() === 'j-b', 'hybrid filter failed');
      assert(ids(JobFilters.apply(jobs, { onsite: true })).join() === 'j-a,j-c', 'onsite filter failed');
      assert(ids(JobFilters.apply(jobs, { remote: true, hybrid: true })).join() === 'j-b,j-d', 'work modes must OR together');
      assert(ids(JobFilters.apply(jobs, { employmentType: 'Contract' })).join() === 'j-b', 'employment type filter failed');
      assert(ids(JobFilters.apply(jobs, { experienceLevel: 'senior' })).join() === 'j-a', 'experience filter failed');
      assert(ids(JobFilters.apply(jobs, { experienceLevel: 'entry' })).join() === 'j-d', 'entry experience failed');
      assert(ids(JobFilters.apply(jobs, { resumeCategory: 'consultant' })).join() === 'j-c', 'resume category filter failed');

      // AND across search + mode + type + experience
      assert(ids(JobFilters.apply(jobs, { search: 'riyadh', onsite: true, employmentType: 'Full-time' })).join() === 'j-a,j-c', 'combined 3-filter failed');
      assert(ids(JobFilters.apply(jobs, { search: 'riyadh', onsite: true, employmentType: 'Full-time', experienceLevel: 'senior' })).join() === 'j-a', 'combined 4-filter failed');
      assert(JobFilters.apply(jobs, { remote: true, employmentType: 'Contract' }).length === 0, 'contradictory filters must return nothing');
      return 'work-mode OR, everything else AND; 4 filters combine correctly';
    }],

    ['4 · Salary filtering (undisclosed is never filtered out)', () => {
      const jobs = fixtures();
      // usdK: A=150, B=90, C≈95.98, D=null (undisclosed)
      assert(JobFilters.salaryK(jobs[3]) === null, 'undisclosed salary must normalize to null');
      assert(Math.round(JobFilters.salaryK(jobs[0])) === 150, 'A should be 150 usdK');
      assert(Math.round(JobFilters.salaryK(jobs[2])) === 96, 'C (SAR/month) should convert to ~96 usdK');

      assert(ids(JobFilters.apply(jobs, { salaryMin: 100 })).join() === 'j-a,j-d', 'min salary filter failed');
      assert(ids(JobFilters.apply(jobs, { salaryMax: 100 })).join() === 'j-b,j-c,j-d', 'max salary filter failed');
      assert(ids(JobFilters.apply(jobs, { salaryMin: 100, salaryMax: 200 })).join() === 'j-a,j-d', 'salary range failed');
      // the existing rule: an undisclosed salary is ALWAYS kept
      assert(ids(JobFilters.apply(jobs, { salaryMin: 999 })).join() === 'j-d', 'undisclosed salary was wrongly filtered out');
      return 'min/max/range work on disclosed salaries; undisclosed always kept (existing rule preserved)';
    }],

    ['5 · Sorting', () => {
      const jobs = fixtures();
      assert(ids(JobFilters.sort(jobs, 'newest')).join() === 'j-a,j-d,j-c,j-b', 'newest first failed');
      assert(ids(JobFilters.sort(jobs, 'oldest')).join() === 'j-b,j-c,j-d,j-a', 'oldest first failed');
      assert(ids(JobFilters.sort(jobs, 'salary_high')).join() === 'j-a,j-c,j-b,j-d', 'salary high→low failed');
      assert(ids(JobFilters.sort(jobs, 'salary_low')).join() === 'j-b,j-c,j-a,j-d', 'salary low→high failed');
      assert(ids(JobFilters.sort(jobs, 'company_az')).join() === 'j-a,j-b,j-c,j-d', 'company A→Z failed');
      // unknown sort falls back to the board's existing order and never throws
      assert(JobFilters.sort(jobs, 'nonsense').length === 4, 'unknown sort must not drop jobs');
      // sorting never mutates the input
      const before = ids(jobs).join();
      JobFilters.sort(jobs, 'company_az');
      assert(ids(jobs).join() === before, 'sort mutated its input array');
      return 'newest / oldest / salary high-low / salary low-high / company A-Z all correct; input never mutated';
    }],

    ['6 · Saving and loading a search', () => {
      SavedSearches.clear();
      const filters = { search: 'riyadh', onsite: true, employmentType: 'Full-time' };
      const r = SavedSearches.save('Riyadh onsite', filters, 'salary_high');
      assert(r.ok && r.entry.id, 'save failed: ' + r.error);
      assert(SavedSearches.all().length === 1, 'saved search not stored');
      assert(SavedSearches.save('', filters, 'match').ok === false, 'an unnamed search must be rejected');

      // load it back into the Job Board controller
      Jobs.clearFilters();
      assert(Jobs.ui.filters.search === '' && Jobs.ui.sort === 'match', 'clearFilters did not reset');
      Jobs.loadSearch(r.entry.id);
      assert(Jobs.ui.filters.search === 'riyadh', 'loaded search did not restore the search term');
      assert(Jobs.ui.filters.onsite === true, 'loaded search did not restore the filters');
      assert(Jobs.ui.sort === 'salary_high', 'loaded search did not restore the sort');

      // and it actually narrows the board
      const jobs = fixtures();
      assert(ids(JobFilters.apply(jobs, Jobs.ui.filters)).join() === 'j-a,j-c', 'loaded search does not filter correctly');
      return 'saved with a name, listed, loaded back into the board (filters + sort restored)';
    }],

    ['7 · Renaming and deleting a saved search', () => {
      SavedSearches.clear();
      const a = SavedSearches.save('First', { search: 'a' }, 'match').entry;
      const b = SavedSearches.save('Second', { search: 'b' }, 'newest').entry;
      assert(SavedSearches.all().length === 2, 'expected 2 saved searches');

      assert(SavedSearches.rename(a.id, 'Renamed').ok === true, 'rename failed');
      assert(SavedSearches.get(a.id).name === 'Renamed', 'name not updated');
      assert(SavedSearches.rename(a.id, '  ').ok === false, 'blank rename must be rejected');
      assert(SavedSearches.get(a.id).name === 'Renamed', 'a rejected rename must not change the name');
      assert(SavedSearches.rename('nope', 'X').ok === false, 'renaming a missing search must fail cleanly');

      assert(SavedSearches.remove(b.id).ok === true, 'delete failed');
      assert(SavedSearches.all().length === 1, 'saved search not deleted');
      assert(SavedSearches.get(b.id) === null, 'deleted search still retrievable');
      assert(SavedSearches.get(a.id).name === 'Renamed', 'deleting one search affected the other');
      assert(SavedSearches.remove('nope').ok === false, 'deleting a missing search must fail cleanly');
      return 'rename updates, blank rename rejected, delete removes only the target';
    }],

    ['8 · Saved searches persist after reload (platform storage)', () => {
      SavedSearches.clear();
      const e = SavedSearches.save('Persisted', { search: 'terraform', remote: true }, 'company_az').entry;

      // stored through the EXISTING platform abstraction, not a private key
      const raw = AppStorage.get(SavedSearches.STORAGE_KEY);
      assert(Array.isArray(raw) && raw.length === 1, 'not stored via AppStorage');
      assert(raw[0].id === e.id && raw[0].name === 'Persisted', 'stored entry is wrong');
      assert(localStorage.getItem('careerpilot_platform.' + SavedSearches.STORAGE_KEY) !== null,
        'not persisted inside the platform namespace');

      // simulate a reload: SavedSearches keeps no in-memory cache, so a fresh
      // read must come straight back from storage
      const after = SavedSearches.all();
      assert(after.length === 1 && after[0].name === 'Persisted', 'saved search did not survive a reload');
      assert(after[0].filters.search === 'terraform' && after[0].filters.remote === true, 'filters did not survive');
      assert(after[0].sort === 'company_az', 'sort did not survive');
      return 'persisted in the platform namespace and read back intact after a simulated reload';
    }],

    ['9 · Existing Job Board behaviour is unchanged', () => {
      const jobs = fixtures();
      JobsStore.setDiscovered(jobs);
      Jobs.reload();
      Jobs.clearFilters();

      const items = Jobs.evaluated();
      assert(items.length === 4, 'evaluated() no longer returns the board jobs');
      assert(items[0].res && items[0].decision, 'MatchEngine / DecisionEngine no longer run');

      // decisions still work and are still persisted
      Jobs.later('j-b');
      assert(JobsStore.load().decisions['j-b'] === 'later', 'decision not persisted');

      // filters are display-only: they must not touch stored jobs or decisions
      Jobs.setFilter('remote', true);
      Jobs.setSort('company_az');
      assert(JobsStore.load().discovered.length === 4, 'filtering changed the stored jobs');
      assert(JobsStore.load().decisions['j-b'] === 'later', 'filtering changed a decision');
      assert(Jobs.evaluated().length === 4, 'filters must not narrow evaluated() — display only');

      // the board still renders, with the new toolbar
      const html = Jobs.render();
      assert(html.indexOf('job-search') !== -1, 'search input missing from the board');
      assert(html.indexOf('Clear filters') !== -1, 'clear-filters button missing');
      assert(html.indexOf('SAVED SEARCHES') !== -1, 'saved searches area missing');
      Jobs.clearFilters();
      return 'evaluated(), decisions and stored data untouched; board renders with the new toolbar';
    }],
  ];

  function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_platform.saved_searches'].forEach(k => {
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
    console.log(`Sprint 19: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', () => render(run()));
})();
