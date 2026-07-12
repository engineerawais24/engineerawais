/* ============================================================
   GulfTalentProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed (no real GulfTalent
   API, no scraping, no credentials, read-only). Injectable
   transport. Its first record is the SAME stc posting Bayt also
   carries — a second cross-provider duplicate for dedup testing.
   ============================================================ */

const GulfTalentProvider = (() => {

  const RAW = [
    { gtId: 'gt-7701', role: 'Cloud Solutions Architect', firm: 'STC', location: 'Riyadh, Saudi Arabia',
      workStyle: 'On-site', engagement: 'Full-time', payLow: 32000, payHigh: 40000, payCurrency: 'SAR', payBasis: 'month',
      posted: '2026-07-05', href: 'https://www.gulftalent.com/saudi-arabia/jobs/cloud-solutions-architect-stc-7701',
      about: 'Architect cloud and IoT solutions for government and enterprise clients across the Kingdom.',
      tags: ['Azure', 'Terraform', 'Cloud fundamentals'], sponsorship: true, expMin: 6, expMax: 10 },

    { gtId: 'gt-7702', role: 'Platform Solutions Lead', firm: 'noon', location: 'Dubai, United Arab Emirates',
      workStyle: 'On-site', engagement: 'Full-time', payLow: null, payHigh: null, payCurrency: 'AED', payBasis: 'month',
      posted: '2026-07-09', href: 'https://www.gulftalent.com/uae/jobs/platform-solutions-lead-noon-7702',
      about: 'Lead marketplace seller-platform integrations; heavy stakeholder work across the region.',
      tags: ['API integration', 'Stakeholder management', 'SQL'], sponsorship: true, expMin: 7, expMax: 12 },
  ];

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
