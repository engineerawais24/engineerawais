/* ============================================================
   JobFilters — search, filtering and sorting for the Job Board
   (Sprint 19).

   A pure, reusable module: it takes the evaluated items Today's
   Jobs already builds ({ job, res, rank, … }) and returns a
   filtered / sorted copy. It never mutates its input, never
   touches storage and never changes the match, GCC or salary
   RULES — it only narrows what the board displays.

   Salary comparison reuses MatchEngine.usdK(), so the existing
   rule holds exactly: an UNDISCLOSED salary is never filtered out.
   ============================================================ */

const JobFilters = (() => {

  const DEFAULTS = {
    search: '',
    remote: false, hybrid: false, onsite: false,
    employmentType: '',      // '' = any
    experienceLevel: '',     // '' = any
    resumeCategory: '',      // '' = any
    salaryMin: '',           // USD-thousands per year (same unit as MatchEngine.usdK)
    salaryMax: '',
  };

  /* 'match' keeps the board's existing priority order — it is the
     default so nothing changes until the user picks a sort. */
  const SORTS = [
    { id: 'match', label: 'Best match (default)' },
    { id: 'newest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
    { id: 'salary_high', label: 'Salary: high to low' },
    { id: 'salary_low', label: 'Salary: low to high' },
    { id: 'company_az', label: 'Company: A to Z' },
  ];

  const EMPLOYMENT_TYPES = ['Full-time', 'Contract', 'Part-time'];

  const EXPERIENCE_LEVELS = [
    { id: 'entry', label: 'Entry / Junior', re: /\b(intern|junior|jr|graduate|entry|associate)\b/i },
    { id: 'senior', label: 'Senior', re: /\b(senior|sr)\b/i },
    { id: 'lead', label: 'Lead / Staff / Principal', re: /\b(lead|staff|principal|head|director|manager)\b/i },
    { id: 'mid', label: 'Mid-level', re: null },      // fallback
  ];

  /* mirrors the role families ResumesStore already uses for its
     résumé variants (architect / consultant / implementation / engineer) */
  const RESUME_CATEGORIES = [
    { id: 'architect', label: 'Architect', re: /architect/i },
    { id: 'consultant', label: 'Consultant', re: /consultant/i },
    { id: 'implementation', label: 'Implementation', re: /implementation|deployed/i },
    { id: 'engineer', label: 'Engineer', re: /engineer|services/i },
    { id: 'general', label: 'General', re: null },     // fallback
  ];

  const lc = s => String(s == null ? '' : s).toLowerCase();
  const jobOf = it => (it && it.job) ? it.job : it;

  function experienceOf(job) {
    const t = String(job.title || '');
    const hit = EXPERIENCE_LEVELS.find(l => l.re && l.re.test(t));
    return hit ? hit.id : 'mid';
  }

  function resumeCategoryOf(job) {
    const t = String(job.title || '');
    const hit = RESUME_CATEGORIES.find(c => c.re && c.re.test(t));
    return hit ? hit.id : 'general';
  }

  /* annual salary in USD-thousands, or null when it must never be
     filtered (undisclosed / text / unknown) — the existing rule */
  function salaryK(job) {
    if (typeof MatchEngine !== 'undefined' && MatchEngine.usdK) return MatchEngine.usdK(job);
    return job.salaryDisclosed && typeof job.salary === 'number' ? job.salary : null;
  }

  /* case-insensitive keyword search across title, company, location, skills */
  function matchesSearch(job, term) {
    const q = lc(term).trim();
    if (!q) return true;
    const hay = lc([job.title, job.company, job.location, (job.skills || []).join(' ')].join(' '));
    return q.split(/\s+/).every(w => hay.indexOf(w) !== -1);
  }

  function normalize(f) {
    return Object.assign({}, DEFAULTS, f || {});
  }

  function isEmpty(f) {
    const x = normalize(f);
    return Object.keys(DEFAULTS).every(k => String(x[k]) === String(DEFAULTS[k]));
  }
  function activeCount(f) {
    const x = normalize(f);
    return Object.keys(DEFAULTS).filter(k => String(x[k]) !== String(DEFAULTS[k])).length;
  }

  /* all filters combine with AND */
  function apply(items, filters) {
    const f = normalize(filters);
    const min = f.salaryMin === '' || f.salaryMin == null ? null : Number(f.salaryMin);
    const max = f.salaryMax === '' || f.salaryMax == null ? null : Number(f.salaryMax);
    const anyMode = f.remote || f.hybrid || f.onsite;

    return (items || []).filter(it => {
      const job = jobOf(it);
      if (!job) return false;

      if (!matchesSearch(job, f.search)) return false;

      if (anyMode) {
        const m = lc(job.workMode);
        const ok = (f.remote && m === 'remote') || (f.hybrid && m === 'hybrid') || (f.onsite && (m === 'on-site' || m === 'onsite'));
        if (!ok) return false;
      }

      if (f.employmentType && lc(job.employmentType) !== lc(f.employmentType)) return false;
      if (f.experienceLevel && experienceOf(job) !== f.experienceLevel) return false;
      if (f.resumeCategory && resumeCategoryOf(job) !== f.resumeCategory) return false;

      if (min != null || max != null) {
        const k = salaryK(job);
        /* undisclosed salaries are NEVER filtered out (existing rule) */
        if (k != null) {
          if (min != null && k < min) return false;
          if (max != null && k > max) return false;
        }
      }
      return true;
    });
  }

  /* stable sort; jobs with no salary/date sink to the bottom */
  function sort(items, sortId) {
    const list = (items || []).slice();
    const key = SORTS.some(s => s.id === sortId) ? sortId : 'match';
    const dateOf = j => { const t = Date.parse(j.postedDate || ''); return isNaN(t) ? null : t; };

    const cmp = {
      match: (a, b) => {
        const sa = a.rank ? a.rank.rankScore : (a.res ? a.res.score : 0);
        const sb = b.rank ? b.rank.rankScore : (b.res ? b.res.score : 0);
        return sb - sa;
      },
      newest: (a, b) => {
        const da = dateOf(jobOf(a)), db = dateOf(jobOf(b));
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return db - da;
      },
      oldest: (a, b) => {
        const da = dateOf(jobOf(a)), db = dateOf(jobOf(b));
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      },
      salary_high: (a, b) => {
        const ka = salaryK(jobOf(a)), kb = salaryK(jobOf(b));
        if (ka == null && kb == null) return 0;
        if (ka == null) return 1;
        if (kb == null) return -1;
        return kb - ka;
      },
      salary_low: (a, b) => {
        const ka = salaryK(jobOf(a)), kb = salaryK(jobOf(b));
        if (ka == null && kb == null) return 0;
        if (ka == null) return 1;
        if (kb == null) return -1;
        return ka - kb;
      },
      company_az: (a, b) => lc(jobOf(a).company).localeCompare(lc(jobOf(b).company)),
    }[key];

    /* deterministic tie-break on job id keeps the order stable */
    return list.sort((a, b) => cmp(a, b) || String(jobOf(a).id).localeCompare(String(jobOf(b).id)));
  }

  return {
    DEFAULTS, SORTS, EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, RESUME_CATEGORIES,
    normalize, isEmpty, activeCount, apply, sort,
    experienceOf, resumeCategoryOf, salaryK, matchesSearch,
  };
})();
