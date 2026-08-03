/* ============================================================
   GulfTalentProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed (no real GulfTalent
   API, no scraping, no credentials, read-only). Injectable
   transport. Its first record is the SAME stc posting Bayt also
   carries — a second cross-provider duplicate for dedup testing.
   ============================================================ */

const GulfTalentProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

  function normalize(r) {
    return {
      sourceId: r.gtId, title: r.role, company: r.firm, location: r.location,
      workMode: r.workStyle, employmentType: r.engagement,
      salaryMin: r.payLow != null ? r.payLow : null, salaryMax: r.payHigh != null ? r.payHigh : null,
      currency: r.payCurrency || null, salaryPeriod: r.payBasis || null,
      experienceMin: r.expMin != null ? r.expMin : null, experienceMax: r.expMax != null ? r.expMax : null,
      description: r.about || '', skills: r.tags || [], certifications: [],
      url: r.href, postedAt: r.posted, visaSupport: !!r.sponsorship, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.role + ' ' + r.firm + ' ' + (r.tags || []).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'gulftalent', label: 'GulfTalent', authType: 'api_key', requires: ['endpoint', 'apiKeyRef'],
    normalize, demoFeed,
  });
})();
