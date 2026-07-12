/* ============================================================
   BaytProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed (no real Bayt API,
   no scraping, no credentials, read-only). Injectable transport.
   ============================================================ */

const BaytProvider = (() => {

  const RAW = [
    { ref: 'bt-3301', title: 'Cloud Solutions Architect', employer: 'Saudi Telecom (stc)', city: 'Riyadh, Saudi Arabia',
      arrangement: 'On-site', contract: 'Full-time', salaryFrom: 32000, salaryTo: 40000, cur: 'SAR', per: 'month',
      date: '2026-07-06', link: 'https://www.bayt.com/en/saudi-arabia/jobs/cloud-solutions-architect-stc-3301/',
      summary: 'Architect cloud and IoT solutions for government and enterprise clients across the Kingdom.',
      keywords: ['Azure', 'Terraform', 'Cloud fundamentals', 'Stakeholder management'], visa: true, expMin: 6, expMax: 10,
      certs: ['AZ-305'] },

    { ref: 'bt-3302', title: 'Solutions Consultant', employer: 'Mobily', city: 'Riyadh, Saudi Arabia',
      arrangement: 'Hybrid', contract: 'Full-time', salaryFrom: 28000, salaryTo: 34000, cur: 'SAR', per: 'month',
      date: '2026-07-04', link: 'https://www.bayt.com/en/saudi-arabia/jobs/solutions-consultant-mobily-3302/',
      summary: 'Pre-sales consulting for enterprise connectivity and cloud offerings.',
      keywords: ['Requirements discovery', 'Workshops', 'Cloud fundamentals'], visa: true, expMin: 4, expMax: 8, certs: [] },

    { ref: 'bt-3303', title: 'Senior Solutions Architect', employer: 'Systems Limited', city: 'Karachi, Pakistan',
      arrangement: 'Hybrid', contract: 'Full-time', salaryFrom: null, salaryTo: null, cur: 'PKR', per: 'month',
      date: '2026-07-10', link: 'https://www.bayt.com/en/pakistan/jobs/senior-solutions-architect-systems-3303/',
      summary: 'Architect cloud solutions for Gulf and North American clients from the Karachi delivery centre.',
      keywords: ['Azure', 'Terraform', 'Kubernetes'], visa: false, expMin: 6, expMax: 10, certs: [] },
  ];

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
