/* ============================================================
   IndeedProvider (Sprint 18 PART 2).

   NOT a real Indeed API and NOT a scraper — a provider abstraction
   over a local mock feed with an injectable transport. No
   credentials. Read-only: it never submits an application.

   Its first record is deliberately the SAME posting LinkedIn also
   carries (different URL/id) so cross-provider deduplication is
   demonstrable end to end.
   ============================================================ */

const IndeedProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

  function normalize(r) {
    const mode = r.remote ? 'Remote' : (r.hybrid ? 'Hybrid' : 'On-site');
    return {
      sourceId: r.jk, title: r.jobtitle, company: r.company, location: r.formattedLocation,
      workMode: mode, employmentType: r.jobType,
      salaryMin: r.salaryMin != null ? r.salaryMin : null, salaryMax: r.salaryMax != null ? r.salaryMax : null,
      currency: r.currency || null, salaryPeriod: r.period || null,
      experienceMin: r.expMin != null ? r.expMin : null, experienceMax: r.expMax != null ? r.expMax : null,
      description: r.snippet || '', skills: r.keywords || [], certifications: [],
      url: r.url, postedAt: r.date, visaSupport: !!r.visa, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.jobtitle + ' ' + r.company + ' ' + (r.keywords || []).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'indeed', label: 'Indeed', authType: 'api_key', requires: ['apiKeyRef'],
    normalize, demoFeed,
  });
})();
