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

  const RAW = [
    { jk: 'in-5501', jobtitle: 'Senior Solutions Engineer', company: 'Careem', formattedLocation: 'Dubai, UAE',
      remote: false, hybrid: true, jobType: 'Full-time', salaryMin: 480, salaryMax: 600, currency: 'AED', period: 'month',
      date: '2026-07-07', url: 'https://www.indeed.com/viewjob?jk=in-5501&from=serp',
      snippet: 'Deliver platform integrations for super-app partners across the Middle East.',
      keywords: ['Python', 'API integration', 'Kubernetes'], visa: true, expMin: 5, expMax: 8 },

    { jk: 'in-5502', jobtitle: 'Cloud Solutions Consultant', company: 'Emirates NBD', formattedLocation: 'Dubai, UAE',
      remote: false, hybrid: false, jobType: 'Full-time', salaryMin: 340, salaryMax: 380, currency: 'AED', period: 'month',
      date: '2026-07-07', url: 'https://www.indeed.com/viewjob?jk=in-5502',
      snippet: 'Advise on Azure landing zones and migration factories for digital transformation.',
      keywords: ['Azure', 'Terraform', 'Banking'], visa: true, expMin: 6, expMax: 10 },

    { jk: 'in-5503', jobtitle: 'Implementation Engineer', company: 'Retool', formattedLocation: 'San Francisco, United States',
      remote: false, hybrid: false, jobType: 'Full-time', salaryMin: 125, salaryMax: 150, currency: 'USD', period: 'year',
      date: '2026-07-05', url: 'https://www.indeed.com/viewjob?jk=in-5503',
      snippet: 'Build internal tools with strategic customers; SQL and JavaScript heavy.',
      keywords: ['SQL', 'JavaScript', 'API integration'], visa: false, expMin: 3, expMax: 6 },
  ];

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
