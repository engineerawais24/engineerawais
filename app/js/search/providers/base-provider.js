/* ============================================================
   BaseProvider — the job-discovery PROVIDER INTERFACE and the
   UNIFIED JOB MODEL (Sprint 18 PART 2 & 3).

   Every provider (LinkedIn, Indeed, Bayt, GulfTalent, Greenhouse,
   Lever) exposes exactly this interface:

     connect(config)          → { ok, configured, connected, note }
     search(filters, context) → { ok, jobs:UnifiedJob[], raw, error }
     normalize(rawJob)        → UnifiedJob
     health()                 → { configured, connected, reachable,
                                  lastSuccessAt, lastFailureAt,
                                  resultCount, lastError }
     disconnect()             → { ok }

   HARD SAFETY RULES (unchanged from Sprint 15):
     • NO real credentials anywhere — config holds env:/secret:/vault:
       REFERENCES only, exactly like ConnectorConfig.
     • NO scraping and NO real network calls to protected sites. The
       default transport is a local MOCK feed; a transport can be
       injected for tests or a future backend.
     • Providers are strictly READ-ONLY. They never submit an
       application and never write profile/resume/application data.

   A provider failure NEVER fails the whole search — the engine
   collects per-provider outcomes and continues.

   ---------------- THE UNIFIED JOB MODEL ----------------
   No provider-specific field may leak past normalize(). Unknown
   values are null / [] / false — consistently.
   ============================================================ */

const BaseProvider = (() => {

  const UNIFIED_FIELDS = [
    'id', 'sourceId', 'title', 'company', 'location', 'city', 'country',
    'salaryMin', 'salaryMax', 'currency', 'salaryPeriod', 'employmentType',
    'experienceMin', 'experienceMax', 'description', 'skills', 'certifications',
    'url', 'provider', 'providers', 'postedAt', 'discoveredAt', 'logo',
    'remote', 'hybrid', 'onsite', 'visaSupport', 'gccRelevant',
    'rawSourceHash', 'updatedAt',
  ];

  const GCC_COUNTRIES = ['saudi arabia', 'ksa', 'uae', 'united arab emirates', 'qatar', 'kuwait', 'bahrain', 'oman'];
  const GCC_CITIES = ['riyadh', 'jeddah', 'dammam', 'khobar', 'dubai', 'abu dhabi', 'sharjah', 'doha', 'kuwait city', 'manama', 'muscat'];

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* stable, dependency-free 32-bit hash (used for rawSourceHash) */
  function hash(input) {
    const s = typeof input === 'string' ? input : JSON.stringify(input || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* URLs are normalized BEFORE duplicate detection (PART 3/4) */
  function canonicalUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    u = u.split('#')[0];
    u = u.split('?')[0];                      // drop tracking params
    u = u.replace(/^https?:\/\//i, '');
    u = u.replace(/^www\./i, '');
    u = u.replace(/\/+$/, '');
    return u.toLowerCase();
  }

  /* ISO date where possible; null when unknown */
  function isoDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00.000Z';
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function splitLocation(location, city, country) {
    const raw = String(location || '');
    const head = raw.split('·')[0].trim();
    const parts = head.split(',').map(p => p.trim()).filter(Boolean);
    return {
      city: city || (parts[0] || null),
      country: country || (parts.length > 1 ? parts[parts.length - 1] : null),
    };
  }

  function isGcc(location, city, country) {
    const hay = lc([location, city, country].filter(Boolean).join(' '));
    return GCC_COUNTRIES.some(c => hay.indexOf(c) !== -1) || GCC_CITIES.some(c => hay.indexOf(c) !== -1);
  }

  /* build a complete UnifiedJob from a partial — every unknown value
     falls back to null / [] / false, consistently. */
  function unified(p) {
    const src = p || {};
    const loc = splitLocation(src.location, src.city, src.country);
    const mode = lc(src.workMode || src.mode || '');
    const remote = src.remote != null ? !!src.remote : mode === 'remote';
    const hybrid = src.hybrid != null ? !!src.hybrid : mode === 'hybrid';
    const onsite = src.onsite != null ? !!src.onsite : (mode === 'on-site' || mode === 'onsite');
    const url = String(src.url || '');
    const provider = src.provider || null;
    const j = {
      id: src.id || ((provider ? String(provider).toLowerCase() + '-' : '') + (src.sourceId || hash(url || JSON.stringify(src)))),
      sourceId: src.sourceId != null ? String(src.sourceId) : null,
      title: src.title || '',
      company: src.company || '',
      location: src.location || '',
      city: loc.city,
      country: loc.country,
      salaryMin: src.salaryMin != null ? src.salaryMin : null,
      salaryMax: src.salaryMax != null ? src.salaryMax : null,
      currency: src.currency || null,
      salaryPeriod: src.salaryPeriod || null,        // 'year' | 'month' | null
      employmentType: src.employmentType || null,
      experienceMin: src.experienceMin != null ? src.experienceMin : null,
      experienceMax: src.experienceMax != null ? src.experienceMax : null,
      description: src.description || '',
      skills: Array.isArray(src.skills) ? src.skills.slice() : [],
      certifications: Array.isArray(src.certifications) ? src.certifications.slice() : [],
      url,
      provider,
      providers: Array.isArray(src.providers) && src.providers.length ? src.providers.slice() : (provider ? [provider] : []),
      postedAt: isoDate(src.postedAt),
      discoveredAt: isoDate(src.discoveredAt) || new Date().toISOString(),
      logo: src.logo || null,
      remote, hybrid, onsite,
      visaSupport: !!src.visaSupport,
      gccRelevant: src.gccRelevant != null ? !!src.gccRelevant : isGcc(src.location, loc.city, loc.country),
      rawSourceHash: src.rawSourceHash || hash([provider, src.sourceId, canonicalUrl(url), src.title, src.company].join('|')),
      updatedAt: isoDate(src.updatedAt) || new Date().toISOString(),
      /* merge provenance — never lose a source (PART 4) */
      mergeMeta: src.mergeMeta || { sourceUrls: url ? [url] : [], sourceIds: src.sourceId ? [String(src.sourceId)] : [], merged: [] },
    };
    return j;
  }

  function validate(job) {
    const problems = [];
    UNIFIED_FIELDS.forEach(f => { if (!(f in job)) problems.push('missing field: ' + f); });
    if (!String(job.title || '').trim()) problems.push('title is empty');
    if (!String(job.company || '').trim()) problems.push('company is empty');
    if (!Array.isArray(job.skills)) problems.push('skills is not an array');
    if (!Array.isArray(job.providers)) problems.push('providers is not an array');
    return problems;
  }

  /* ---------- the provider factory ---------- */
  function createProvider(spec) {
    const state = {
      configured: false, connected: false, reachable: null,
      lastSuccessAt: null, lastFailureAt: null, resultCount: 0, lastError: null,
    };
    let config = {};

    const self = {
      id: spec.id,
      label: spec.label,
      authType: spec.authType || 'none',
      requires: spec.requires || [],

      /* config holds REFERENCES only — never a credential value */
      connect(cfg) {
        config = Object.assign({}, cfg || {});
        const missing = self.requires.filter(k => !String(config[k] || '').trim());
        state.configured = missing.length === 0;
        state.connected = true;                    // mock transport is always "connected"
        return {
          ok: true, id: self.id, configured: state.configured, connected: true,
          note: state.configured
            ? 'Connected (mock transport — no real network access)'
            : 'Connected in demo mode; live mode needs reference(s): ' + missing.join(', '),
        };
      },

      normalize(raw) {
        const u = unified(spec.normalize ? spec.normalize(raw) : raw);
        u.provider = spec.label;
        u.providers = [spec.label];
        return u;
      },

      /* search — NEVER throws. A failure is returned, so one provider
         going down can never fail the whole search. */
      async search(filters, context) {
        const ctx = context || {};
        const signal = ctx.signal || null;
        try {
          if (signal && signal.aborted) throw new Error('cancelled');
          const transport = ctx.transport || spec.transport || null;
          let raws;
          if (transport) {
            const res = await transport({ provider: spec.id, filters: filters || {}, signal });
            if (res && res.ok === false) throw new Error(res.error || 'provider transport failed');
            raws = (res && res.jobs) || [];
          } else {
            raws = spec.demoFeed(filters || {});          // local mock feed
          }
          if (signal && signal.aborted) throw new Error('cancelled');

          const jobs = raws.map(r => self.normalize(r)).filter(j => validate(j).length === 0);
          state.reachable = true;
          state.lastSuccessAt = Date.now();
          state.resultCount = jobs.length;
          state.lastError = null;
          return { ok: true, provider: spec.label, jobs, rawCount: raws.length };
        } catch (e) {
          const cancelled = /cancel/i.test(e && e.message || '');
          state.reachable = false;
          state.lastFailureAt = Date.now();
          state.lastError = (e && e.message) || 'provider failed';
          state.resultCount = 0;
          return { ok: false, provider: spec.label, jobs: [], cancelled, error: state.lastError };
        }
      },

      health() {
        return {
          id: self.id, label: self.label,
          configured: state.configured, connected: state.connected, reachable: state.reachable,
          lastSuccessAt: state.lastSuccessAt, lastFailureAt: state.lastFailureAt,
          resultCount: state.resultCount, lastError: state.lastError,
        };
      },

      disconnect() {
        state.connected = false;
        config = {};
        return { ok: true, id: self.id, note: 'Disconnected — no live session existed (mock transport).' };
      },
    };
    return self;
  }

  return { UNIFIED_FIELDS, unified, validate, canonicalUrl, hash, isoDate, isGcc, createProvider };
})();
