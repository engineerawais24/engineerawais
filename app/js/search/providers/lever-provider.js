/* ============================================================
   LeverProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed shaped like the
   PUBLIC Lever postings payload. No credentials, no scraping,
   read-only, injectable transport.
   ============================================================ */

const LeverProvider = (() => {

  const RAW = [
    { id: 'lv-4401', text: 'Platform Solutions Engineer',
      categories: { team: 'Solutions', location: 'Remote, EU', commitment: 'Full-time' },
      descriptionPlain: 'Partner with enterprise accounts on platform migrations and edge architecture reviews.',
      hostedUrl: 'https://jobs.lever.co/globex/4401', createdAt: 1751932800000,
      lists: [{ text: 'Skills', content: 'Kubernetes, Terraform, Client delivery' }],
      extra: { salary_min: 95, salary_max: 130, currency: 'EUR', period: 'year', remote: true, visa: false, exp_min: 4, exp_max: 8 } },

    { id: 'lv-4402', text: 'Technical Account Manager',
      categories: { team: 'Customer', location: 'Dubai, United Arab Emirates', commitment: 'Full-time' },
      descriptionPlain: 'Own post-sales technical relationships for strategic Gulf accounts.',
      hostedUrl: 'https://jobs.lever.co/globex/4402', createdAt: 1751846400000,
      lists: [{ text: 'Skills', content: 'Stakeholder management, API integration, SQL' }],
      extra: { salary_min: null, salary_max: null, currency: 'AED', period: 'month', remote: false, visa: true, exp_min: 5, exp_max: 9 } },
  ];

  function skillsFrom(lists) {
    const row = (lists || []).find(l => /skill/i.test(l.text || ''));
    if (!row || !row.content) return [];
    return String(row.content).split(',').map(s => s.trim()).filter(Boolean);
  }

  function normalize(r) {
    const c = r.categories || {};
    const x = r.extra || {};
    return {
      sourceId: r.id, title: r.text, company: 'Globex', location: c.location || '',
      workMode: x.remote ? 'Remote' : 'On-site', employmentType: c.commitment || null,
      salaryMin: x.salary_min != null ? x.salary_min : null, salaryMax: x.salary_max != null ? x.salary_max : null,
      currency: x.currency || null, salaryPeriod: x.period || null,
      experienceMin: x.exp_min != null ? x.exp_min : null, experienceMax: x.exp_max != null ? x.exp_max : null,
      description: r.descriptionPlain || '', skills: skillsFrom(r.lists), certifications: [],
      url: r.hostedUrl, postedAt: new Date(r.createdAt).toISOString(), visaSupport: !!x.visa, logo: null,
    };
  }

  function demoFeed(filters) {
    const q = String((filters && filters.query) || '').toLowerCase().trim();
    if (!q) return RAW.slice();
    return RAW.filter(r => (r.text + ' ' + skillsFrom(r.lists).join(' ')).toLowerCase().indexOf(q) !== -1);
  }

  return BaseProvider.createProvider({
    id: 'lever', label: 'Lever', authType: 'none', requires: ['endpoint'],
    normalize, demoFeed,
  });
})();
