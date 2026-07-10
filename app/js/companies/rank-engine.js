/* ============================================================
   RankEngine — job priority ranking (Sprint 8C).

   Pure layer ON TOP of the MatchEngine score: the calibrated
   0–100 match score is never modified. Ranking applies signed
   adjustments (company tier, region, role family, sponsorship,
   seniority penalties) to produce a rankScore used only for
   ordering — every adjustment is listed in the "Why ranked
   here?" panel. Hard filters (salary below minimum, non-GCC
   on-site without sponsorship) stay in MatchEngine untouched.
   ============================================================ */

const RankEngine = (() => {

  /* recognizably multinational employers (mock heuristic —
     the backend replaces this with real company data) */
  const MNC = ['cisco', 'microsoft', 'accenture', 'dell', 'oracle', 'ibm',
    'google', 'amazon', 'juniper', 'fortinet', 'palo alto', 'huawei',
    'deloitte', 'pwc', 'kpmg', 'stripe', 'datadog', 'hashicorp', 'vercel',
    'palantir', 'retool', 'careem', 'noon', 'aramco', 'etisalat', 'stc',
    'emirates nbd'];

  const ROLE_BOOSTS = [
    [/senior\s+technical\s+consultant/i, 'Senior Technical Consultant role'],
    [/technical\s+delivery\s+lead/i,     'Technical Delivery Lead role'],
    [/implementation\s+lead/i,           'Implementation Lead role'],
    [/system[s]?\s+integration/i,        'Systems Integration role'],
    [/infrastructure\s+consult/i,        'Infrastructure Consulting role'],
    [/pre-?sales|professional\s+services/i, 'Presales / Professional Services role'],
  ];

  const JUNIOR = /junior|\bjr\.?\b|intern(ship)?\b|entry[-\s]?level|graduate\b|trainee/i;
  const SAUDI = /saudi|riyadh|jeddah|dammam|khobar/i;

  function rank(job, res, cfg) {
    const tier = CompaniesStore.tierOf(job.company, cfg);
    const adjustments = [];
    const add = (label, pts) => adjustments.push({ label, pts });

    if (cfg.boosting) {
      /* company intelligence */
      if (tier === 1) add('Tier 1 priority company', 12);
      else if (tier === 2) add('Tier 2 priority company', 6);
      if (MNC.some(m => String(job.company).toLowerCase().includes(m))) {
        add('Multinational company', 3);
      }

      /* region */
      const gcc = MatchEngine.isGCC(job.location);
      if (SAUDI.test(job.location || '')) add('Saudi Arabia role', 6);
      else if (gcc) add('GCC role', 4);
      if (job.workMode === 'Remote' && !gcc) add('Remote international role', 3);

      /* mobility */
      if (job.visaSponsorship) add('Visa sponsorship', 3);
      if (job.relocationSupport) add('Relocation support', 3);

      /* role families */
      ROLE_BOOSTS.forEach(([re, label]) => {
        if (re.test(job.title || '')) add(label, 5);
      });

      /* seniority penalty — ranked down, never silently deleted */
      if (JUNIOR.test(job.title || '')) add('Junior / entry-level role', -15);
    }

    const boost = adjustments.reduce((n, a) => n + a.pts, 0);
    return {
      tier,
      tierLabel: `Company tier ${tier}${tier === 1 ? ' · highest' : tier === 2 ? ' · high' : ' · standard'}`,
      adjustments,
      boost,
      rankScore: res.score + boost,
    };
  }

  return { rank, MNC, JUNIOR };
})();
