/* ============================================================
   LeverProvider (Sprint 18 PART 2).

   Provider abstraction over a local mock feed shaped like the
   PUBLIC Lever postings payload. No credentials, no scraping,
   read-only, injectable transport.
   ============================================================ */

const LeverProvider = (() => {

  /* Emptied 2026-08-03 — no demo jobs. This provider is a local mock feed;
     with it empty, a search returns nothing rather than sample postings. */
  const RAW = [];

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
