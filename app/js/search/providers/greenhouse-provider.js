/* ============================================================
   GreenhouseProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed shaped like the
   PUBLIC Greenhouse Job Board payload. No credentials, no
   scraping, read-only, injectable transport.
   ============================================================ */

const GreenhouseProvider = (() => {

  const RAW = [
    { id: 'gh-9901', title: 'Solutions Engineer', company: { name: 'Acme Cloud' },
      location: { name: 'Remote, United States' }, absolute_url: 'https://boards.greenhouse.io/acmecloud/jobs/9901',
      updated_at: '2026-07-09T10:00:00Z',
      content: 'Own technical delivery end to end for enterprise customers; Terraform, Kubernetes and Azure.',
      metadata: { employment_type: 'Full-time', remote: true, skills: ['Terraform', 'Kubernetes', 'Azure', 'Python'],
        salary_min: 140, salary_max: 175, currency: 'USD', period: 'year', visa: false, exp_min: 5, exp_max: 9 } },

    { id: 'gh-9902', title: 'Professional Services Engineer', company: { name: 'HashiCorp' },
      location: { name: 'Remote, United States' }, absolute_url: 'https://boards.greenhouse.io/hashicorp/jobs/9902',
      updated_at: '2026-07-08T09:00:00Z',
      content: 'Deliver Terraform and Vault engagements for regulated enterprises; deep IaC review work.',
      metadata: { employment_type: 'Full-time', remote: true, skills: ['Terraform', 'Kubernetes', 'Client delivery'],
        salary_min: 170, salary_max: 200, currency: 'USD', period: 'year', visa: false, exp_min: 6, exp_max: 10 } },
  ];

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
