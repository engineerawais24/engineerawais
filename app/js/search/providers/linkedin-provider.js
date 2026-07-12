/* ============================================================
   LinkedInProvider (Sprint 18 PART 2).

   NOT a real LinkedIn API and NOT a scraper. This is a provider
   ABSTRACTION over a local mock feed; a transport can be injected
   (tests / a future backend). Credentials are never stored — live
   mode would need a backend-held session REFERENCE only.
   ============================================================ */

const LinkedInProvider = (() => {

  const RAW = [
    { jobId: 'li-8801', position: 'Senior Solutions Engineer', org: 'Careem', place: 'Dubai, United Arab Emirates',
      mode: 'Hybrid', type: 'Full-time', payMin: 480, payMax: 600, payCur: 'AED', payPeriod: 'month',
      listedOn: '2026-07-08', url: 'https://www.linkedin.com/jobs/view/8801?trk=feed',
      blurb: 'Deliver platform integrations for super-app partners across the Middle East; own PoCs end to end.',
      skills: ['Python', 'Kubernetes', 'API integration', 'Client delivery'], sponsor: true, expMin: 5, expMax: 8 },

    { jobId: 'li-8802', position: 'Staff Solutions Architect', org: 'Stripe', place: 'Remote, United States',
      mode: 'Remote', type: 'Full-time', payMin: 185, payMax: 215, payCur: 'USD', payPeriod: 'year',
      listedOn: '2026-07-09', url: 'https://www.linkedin.com/jobs/view/8802',
      blurb: 'Own the technical architecture for enterprise payment migrations and complex evaluations.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Payments'], sponsor: true, expMin: 8, expMax: 12 },

    { jobId: 'li-8803', position: 'Technical Consultant', org: 'Datadog', place: 'New York, United States',
      mode: 'Hybrid', type: 'Full-time', payMin: 150, payMax: 180, payCur: 'USD', payPeriod: 'year',
      listedOn: '2026-07-06', url: 'https://www.linkedin.com/jobs/view/8803',
      blurb: 'Guide enterprise observability rollouts; workshops, dashboards-as-code, migration playbooks.',
      skills: ['Python', 'Kubernetes', 'Observability'], sponsor: false, expMin: 4, expMax: 7 },
  ];

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
