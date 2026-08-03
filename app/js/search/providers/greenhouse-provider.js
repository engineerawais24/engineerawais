/* ============================================================
   GreenhouseProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed shaped like the
   PUBLIC Greenhouse Job Board payload. No credentials, no
   scraping, read-only, injectable transport.
   ============================================================ */

const GreenhouseProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

  function normalize(r) {
    const m = r.metadata || {};
    return {
      sourceId: r.id, title: r.title, company: (r.company && r.company.name) || '',
      location: (r.location && r.location.name) || '',
      workMode: m.remote ? 'Remote' : 'On-site', employmentType: m.employment_type || null,
      salaryMin: m.salary_min != null ? m.salary_min : null, salaryMax: m.salary_max != null ? m.salary_max : null,
      currency: m.currency || null, salaryPeriod: m.period || null,
      experienceMin: m.exp_min != null ? m.exp_min : null, experienceMax: m.exp_max != null ? m.exp_max : null,
      description: r.content || '', skills: m.skills || [], certifications: [],
      url: r.absolute_url, postedAt: r.updated_at, visaSupport: !!m.visa, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.title + ' ' + ((r.company || {}).name || '') + ' ' + ((r.metadata || {}).skills || []).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'greenhouse', label: 'Greenhouse', authType: 'none', requires: ['endpoint'],
    normalize, demoFeed,
  });
})();
