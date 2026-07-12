/* ============================================================
   DiscoveryJob — the unified job model the Discovery Engine
   exposes to the rest of the app (Sprint 25).

   Providers already emit a BaseProvider "unified" record (Sprint 18).
   This is the layer above it: the shape the UI and the match engine
   actually consume, with the derived fields they need —

     id · provider · providers[] · company · title · location
     workplaceType (Remote | Hybrid | On Site) · salary · summary
     skills[] · experienceLevel · postedDate · applyUrl
     confidence · logo (placeholder)

   Nothing provider-specific may leak past `from()`. Unknown values
   are null / [] consistently, never undefined.

   The model is pure: no DOM, no storage, no network.
   ============================================================ */

const DiscoveryJob = (() => {

  const FIELDS = [
    'id', 'provider', 'providers', 'company', 'title', 'location',
    'workplaceType', 'salary', 'summary', 'skills', 'experienceLevel',
    'postedDate', 'applyUrl', 'confidence', 'logo',
  ];

  const WORKPLACE = ['Remote', 'Hybrid', 'On Site'];
  const LEVELS = ['Entry', 'Mid', 'Senior', 'Lead'];

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* ---------- derived: workplace type ----------
     A BaseProvider unified record carries the booleans; a raw record may only
     carry the mode string, so fall back to it rather than silently reporting
     a remote job as on-site. */
  function workplaceOf(u) {
    if (u.remote) return 'Remote';
    if (u.hybrid) return 'Hybrid';
    if (u.onsite) return 'On Site';
    const mode = lc(u.workMode || u.mode || '');
    if (mode === 'remote') return 'Remote';
    if (mode === 'hybrid') return 'Hybrid';
    return 'On Site';
  }

  /* ---------- derived: experience level ----------
     The posting's own years take priority; the title is the fallback. */
  const TITLE_LEVELS = [
    { id: 'Lead', re: /\b(lead|staff|principal|head|director|vp|manager)\b/i },
    { id: 'Senior', re: /\b(senior|sr)\b/i },
    { id: 'Entry', re: /\b(junior|jr|graduate|intern|entry|associate)\b/i },
  ];
  function experienceLevelOf(title, experienceMin) {
    const years = experienceMin;
    if (typeof years === 'number' && !isNaN(years)) {
      if (years >= 9) return 'Lead';
      if (years >= 5) return 'Senior';
      if (years >= 2) return 'Mid';
      return 'Entry';
    }
    const hit = TITLE_LEVELS.find(l => l.re.test(String(title || '')));
    return hit ? hit.id : 'Mid';
  }
  function levelRank(id) { const i = LEVELS.indexOf(id); return i === -1 ? 1 : i; }

  /* ---------- derived: salary (optional — null when undisclosed) ---------- */
  function salaryOf(u) {
    if (u.salaryMin == null && u.salaryMax == null) return null;
    return {
      min: u.salaryMin != null ? u.salaryMin : null,
      max: u.salaryMax != null ? u.salaryMax : null,
      currency: u.currency || 'USD',
      period: u.salaryPeriod === 'month' ? 'month' : 'year',
    };
  }

  /* annualised, in thousands of the source currency — the comparable
     figure the salary-range filter and the UI both need */
  function annualK(salary) {
    if (!salary) return null;
    const v = salary.min != null ? salary.min : salary.max;
    if (v == null) return null;
    /* yearly figures are already in thousands; monthly ones are absolute */
    return salary.period === 'month' ? (Number(v) * 12) / 1000 : Number(v);
  }

  /* ---------- derived: confidence ----------
     How much we trust THIS record: how reliable the provider is, and how
     complete the posting is. Deterministic — the same record always scores
     the same, so duplicate merging can pick a winner reproducibly. */
  const COMPLETENESS = [
    { k: 'title', w: 10, has: j => !!String(j.title || '').trim() },
    { k: 'company', w: 10, has: j => !!String(j.company || '').trim() },
    { k: 'location', w: 6, has: j => !!String(j.location || '').trim() },
    { k: 'url', w: 8, has: j => !!String(j.url || '').trim() },
    { k: 'description', w: 8, has: j => String(j.description || '').length > 40 },
    { k: 'skills', w: 10, has: j => (j.skills || []).length > 0 },
    { k: 'salary', w: 4, has: j => j.salaryMin != null || j.salaryMax != null },
    { k: 'postedAt', w: 4, has: j => !!j.postedAt },
  ];
  const COMPLETENESS_TOTAL = COMPLETENESS.reduce((n, c) => n + c.w, 0);   // 60

  function confidenceOf(u, providerWeight) {
    const w = typeof providerWeight === 'number' ? providerWeight : 0.8;
    const complete = COMPLETENESS.reduce((n, c) => n + (c.has(u) ? c.w : 0), 0) / COMPLETENESS_TOTAL;
    /* provider reliability is worth 40, completeness 60 */
    const score = Math.round((Math.max(0, Math.min(1, w)) * 40) + (complete * 60));
    return Math.max(0, Math.min(100, score));
  }

  /* ---------- derived: company logo placeholder ----------
     The board has never had real logo URLs; it falls back to a monogram.
     The model carries that fallback explicitly so a real logo URL can drop
     in later (`url`) without any UI change. */
  const LOGO_COLORS = ['#3538CD', '#1E7A4D', '#B7791F', '#B23A2E', '#0E7C7B', '#6B4EFF', '#2B579A'];
  function logoFor(company, url) {
    const name = String(company || '').trim();
    const initials = name
      ? name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
      : '?';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return {
      url: url || null,                                   // null until a real logo exists
      monogram: initials,
      color: LOGO_COLORS[h % LOGO_COLORS.length],
      placeholder: !url,
    };
  }

  /* ---------- the model ---------- */

  /* build a DiscoveryJob from a BaseProvider unified record */
  function from(u, opts) {
    const src = u || {};
    const o = opts || {};
    const salary = salaryOf(src);
    const providers = (src.providers && src.providers.length)
      ? src.providers.slice()
      : (src.provider ? [src.provider] : []);
    return {
      id: src.id || '',
      provider: src.provider || providers[0] || null,
      providers,
      company: src.company || '',
      title: src.title || '',
      location: src.location || [src.city, src.country].filter(Boolean).join(', '),
      workplaceType: workplaceOf(src),
      salary,
      salaryK: annualK(salary),
      summary: src.description || '',
      skills: Array.isArray(src.skills) ? src.skills.slice() : [],
      certifications: Array.isArray(src.certifications) ? src.certifications.slice() : [],
      experienceLevel: experienceLevelOf(src.title, src.experienceMin),
      experienceMin: src.experienceMin != null ? src.experienceMin : null,
      postedDate: src.postedAt ? String(src.postedAt).slice(0, 10) : null,
      applyUrl: src.url || '',
      confidence: confidenceOf(src, o.providerWeight),
      logo: logoFor(src.company, src.logo),
      /* carried through, not part of the public contract */
      employmentType: src.employmentType || 'Full-time',
      visaSupport: !!src.visaSupport,
      canonicalUrl: (typeof BaseProvider !== 'undefined') ? BaseProvider.canonicalUrl(src.url) : lc(src.url),
      sourceIds: src.sourceId ? [String(src.sourceId)] : [],
      sourceUrls: src.url ? [src.url] : [],
    };
  }

  function validate(job) {
    const problems = [];
    FIELDS.forEach(f => { if (!(f in (job || {}))) problems.push('missing field: ' + f); });
    if (!job) return problems;
    if (!String(job.title || '').trim()) problems.push('title is empty');
    if (!String(job.company || '').trim()) problems.push('company is empty');
    if (!Array.isArray(job.providers) || !job.providers.length) problems.push('providers is empty');
    if (WORKPLACE.indexOf(job.workplaceType) === -1) problems.push('bad workplaceType: ' + job.workplaceType);
    if (LEVELS.indexOf(job.experienceLevel) === -1) problems.push('bad experienceLevel: ' + job.experienceLevel);
    if (typeof job.confidence !== 'number' || job.confidence < 0 || job.confidence > 100) problems.push('bad confidence');
    return problems;
  }

  return {
    FIELDS, WORKPLACE, LEVELS,
    from, validate, workplaceOf, experienceLevelOf, levelRank,
    salaryOf, annualK, confidenceOf, logoFor,
  };
})();
