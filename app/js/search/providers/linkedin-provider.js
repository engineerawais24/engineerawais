/* ============================================================
   LinkedInProvider (Sprint 18 PART 2).

   NOT a real LinkedIn API and NOT a scraper. This is a provider
   ABSTRACTION over a local mock feed; a transport can be injected
   (tests / a future backend). Credentials are never stored — live
   mode would need a backend-held session REFERENCE only.
   ============================================================ */

const LinkedInProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

  function normalize(r) {
    return {
      sourceId: r.jobId, title: r.position, company: r.org, location: r.place,
      workMode: r.mode, employmentType: r.type,
      salaryMin: r.payMin != null ? r.payMin : null, salaryMax: r.payMax != null ? r.payMax : null,
      currency: r.payCur || null, salaryPeriod: r.payPeriod || null,
      experienceMin: r.expMin != null ? r.expMin : null, experienceMax: r.expMax != null ? r.expMax : null,
      description: r.blurb || '', skills: r.skills || [], certifications: [],
      url: r.url, postedAt: r.listedOn, visaSupport: !!r.sponsor, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.position + ' ' + r.org + ' ' + (r.skills || []).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'linkedin', label: 'LinkedIn', authType: 'session', requires: ['sessionRef'],
    normalize, demoFeed,
  });
})();
