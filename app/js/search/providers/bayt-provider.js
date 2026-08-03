/* ============================================================
   BaytProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed (no real Bayt API,
   no scraping, no credentials, read-only). Injectable transport.
   ============================================================ */

const BaytProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

  function normalize(r) {
    return {
      sourceId: r.ref, title: r.title, company: r.employer, location: r.city,
      workMode: r.arrangement, employmentType: r.contract,
      salaryMin: r.salaryFrom != null ? r.salaryFrom : null, salaryMax: r.salaryTo != null ? r.salaryTo : null,
      currency: r.cur || null, salaryPeriod: r.per || null,
      experienceMin: r.expMin != null ? r.expMin : null, experienceMax: r.expMax != null ? r.expMax : null,
      description: r.summary || '', skills: r.keywords || [], certifications: r.certs || [],
      url: r.link, postedAt: r.date, visaSupport: !!r.visa, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.title + ' ' + r.employer + ' ' + (r.keywords || []).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'bayt', label: 'Bayt', authType: 'api_key', requires: ['endpoint', 'apiKeyRef'],
    normalize, demoFeed,
  });
})();
