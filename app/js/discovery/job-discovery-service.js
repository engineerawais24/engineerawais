/* ============================================================
   JobDiscoveryService — the multi-source Job Discovery Engine
   (Sprint 25).

   Searches every registered provider in parallel, normalizes the
   results into the unified DiscoveryJob model, merges duplicates
   across providers, scores each job against the user's profile and
   returns one ranked list.

   ARCHITECTURE
   ------------
   • Providers are REGISTERED, not imported. Each registration carries
     a `resolve()` thunk, so a provider is only looked up when a search
     actually runs (lazy) and is memoized after that. Nothing here holds
     a hard reference to LinkedInProvider et al — if a provider file is
     not loaded, that source is simply reported as unavailable and the
     search continues.
   • Swapping a mock provider for a real API is therefore a one-line
     re-registration. It requires NO change to this service, to the
     match engine, or to any screen:
         JobDiscoveryService.register('linkedin', {
           label: 'LinkedIn', weight: 0.95, resolve: () => RealLinkedInProvider
         });
   • A provider failure NEVER fails the search — outcomes are collected
     per provider and the merge continues with whatever arrived.

   SAFETY (unchanged from Sprints 15/18)
   -------------------------------------
   Providers are read-only, use a local mock feed by default, hold no
   credentials, and never submit anything.
   ============================================================ */

const JobDiscoveryService = (() => {

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* ---------- provider registry (lazy, no hardcoded dependencies) ---------- */

  const REGISTRY = {};      // id → { id, label, weight, resolve, _instance }

  function register(id, spec) {
    if (!id || !spec || typeof spec.resolve !== 'function') return null;
    REGISTRY[id] = {
      id,
      label: spec.label || id,
      weight: typeof spec.weight === 'number' ? spec.weight : 0.8,   // provider reliability
      resolve: spec.resolve,
      _instance: undefined,                                          // resolved on first use
    };
    return REGISTRY[id];
  }

  function unregister(id) { delete REGISTRY[id]; }
  function registered() { return Object.keys(REGISTRY); }

  /* resolve lazily, then memoize. A provider that cannot be resolved is
     not an error — it is simply unavailable. */
  function instance(id) {
    const entry = REGISTRY[id];
    if (!entry) return null;
    if (entry._instance === undefined) {
      try { entry._instance = entry.resolve() || null; }
      catch (e) { entry._instance = null; }
    }
    return entry._instance;
  }

  function available() { return registered().filter(id => !!instance(id)); }
  function weightOf(id) { return REGISTRY[id] ? REGISTRY[id].weight : 0.8; }
  function labelOf(id) {
    const p = instance(id);
    return (p && p.label) || (REGISTRY[id] && REGISTRY[id].label) || id;
  }
  /* drop memoized instances so a re-registration takes effect immediately */
  function reset() { registered().forEach(id => { REGISTRY[id]._instance = undefined; }); }

  /* the four sources this sprint ships, all still mock-backed */
  register('linkedin',   { label: 'LinkedIn',   weight: 0.92, resolve: () => (typeof LinkedInProvider   !== 'undefined' ? LinkedInProvider   : null) });
  register('indeed',     { label: 'Indeed',     weight: 0.80, resolve: () => (typeof IndeedProvider     !== 'undefined' ? IndeedProvider     : null) });
  register('bayt',       { label: 'Bayt',       weight: 0.85, resolve: () => (typeof BaytProvider       !== 'undefined' ? BaytProvider       : null) });
  register('gulftalent', { label: 'GulfTalent', weight: 0.85, resolve: () => (typeof GulfTalentProvider !== 'undefined' ? GulfTalentProvider : null) });

  /* ---------- filters ---------- */

  function normalizeFilters(f) {
    const x = f || {};
    return {
      keywords: String(x.keywords || x.query || '').trim(),
      location: String(x.location || '').trim(),
      remoteOnly: !!x.remoteOnly,
      experienceLevel: DiscoveryJob.LEVELS.indexOf(x.experienceLevel) !== -1 ? x.experienceLevel : null,
      salaryMin: x.salaryMin != null && x.salaryMin !== '' ? Number(x.salaryMin) : null,
      salaryMax: x.salaryMax != null && x.salaryMax !== '' ? Number(x.salaryMax) : null,
      providers: Array.isArray(x.providers) ? x.providers.filter(Boolean) : [],
    };
  }

  function matchesKeywords(job, kw) {
    if (!kw) return true;
    const hay = lc([job.title, job.company, job.summary, (job.skills || []).join(' ')].join(' '));
    /* every word must appear somewhere — an AND search, like the board's */
    return lc(kw).split(/\s+/).filter(Boolean).every(w => hay.indexOf(w) !== -1);
  }

  function applyFilters(jobs, filters) {
    const f = normalizeFilters(filters);
    return (jobs || []).filter(job => {
      if (!matchesKeywords(job, f.keywords)) return false;
      if (f.location && lc(job.location).indexOf(lc(f.location)) === -1) return false;
      if (f.remoteOnly && job.workplaceType !== 'Remote') return false;
      if (f.experienceLevel && job.experienceLevel !== f.experienceLevel) return false;
      /* salary range: an undisclosed salary is NEVER filtered out — the same
         rule the board has always used, so a good job is not lost silently */
      const k = job.salaryK;
      if (k != null) {
        if (f.salaryMin != null && k < f.salaryMin) return false;
        if (f.salaryMax != null && k > f.salaryMax) return false;
      }
      return true;
    });
  }

  /* ---------- duplicate detection ----------
     The same posting reaches us from several boards. Merge them into ONE
     job that remembers every provider it was seen on and keeps the highest
     confidence record as the master — so no duplicate cards, and no source
     is ever lost. */

  function keyFor(job) {
    /* the canonical apply URL is the strongest signal when present … */
    if (job.canonicalUrl) return 'u:' + job.canonicalUrl;
    /* … otherwise the same role at the same company in the same city */
    const city = lc(job.location).split(/[,·]/)[0].trim();
    return 't:' + [lc(job.company), lc(job.title), city].join('|');
  }

  /* a second pass: identical company+title+city, even when the URLs differ */
  function softKeyFor(job) {
    const city = lc(job.location).split(/[,·]/)[0].trim();
    return [lc(job.company), lc(job.title), city].join('|');
  }

  function mergeJobs(master, dup) {
    /* keep the higher-confidence record as the master */
    const a = master.confidence >= dup.confidence ? master : dup;
    const b = master.confidence >= dup.confidence ? dup : master;

    const merged = Object.assign({}, a);
    merged.confidence = Math.max(master.confidence, dup.confidence);   // highest wins
    merged.providers = Array.from(new Set((master.providers || []).concat(dup.providers || [])));
    merged.provider = merged.providers[0] || a.provider;
    merged.skills = Array.from(new Set((a.skills || []).concat(b.skills || [])));
    merged.certifications = Array.from(new Set((a.certifications || []).concat(b.certifications || [])));
    /* fill any gap in the master from the other record */
    if (!merged.salary && b.salary) { merged.salary = b.salary; merged.salaryK = b.salaryK; }
    if (!merged.summary) merged.summary = b.summary || '';
    if (!merged.postedDate) merged.postedDate = b.postedDate;
    if (!merged.applyUrl) merged.applyUrl = b.applyUrl || '';
    merged.sourceIds = Array.from(new Set((master.sourceIds || []).concat(dup.sourceIds || [])));
    merged.sourceUrls = Array.from(new Set((master.sourceUrls || []).concat(dup.sourceUrls || [])));
    merged.duplicateCount = (master.duplicateCount || 0) + (dup.duplicateCount || 0) + 1;
    return merged;
  }

  function deduplicate(jobs) {
    const byKey = {};
    const order = [];
    let removed = 0;

    (jobs || []).forEach(job => {
      const k = keyFor(job);
      if (byKey[k]) { byKey[k] = mergeJobs(byKey[k], job); removed++; }
      else { byKey[k] = job; order.push(k); }
    });

    /* soft pass — the same posting on two boards rarely shares a URL */
    const bySoft = {};
    const out = [];
    order.forEach(k => {
      const job = byKey[k];
      const sk = softKeyFor(job);
      if (bySoft[sk] != null) {
        out[bySoft[sk]] = mergeJobs(out[bySoft[sk]], job);
        removed++;
      } else {
        bySoft[sk] = out.length;
        out.push(job);
      }
    });

    return { jobs: out, removed };
  }

  /* ---------- search ---------- */

  /* Every provider is asked in parallel. A provider that fails, is missing,
     or throws is recorded and skipped — the search still returns. */
  async function search(filters, options) {
    const startedAt = Date.now();
    const f = normalizeFilters(filters);
    const opts = options || {};
    const ids = (f.providers.length ? f.providers : registered())
      .filter(id => !!REGISTRY[id]);

    const outcomes = await Promise.all(ids.map(async id => {
      const p = instance(id);
      if (!p) {
        return { id, label: labelOf(id), ok: false, count: 0, jobs: [], error: 'provider not available' };
      }
      try {
        const res = await p.search({ query: f.keywords }, { transport: opts.transport || null });
        if (!res || res.ok === false) {
          return { id, label: labelOf(id), ok: false, count: 0, jobs: [], error: (res && res.error) || 'provider failed' };
        }
        const jobs = (res.jobs || [])
          .map(u => DiscoveryJob.from(u, { providerWeight: weightOf(id) }))
          .filter(j => DiscoveryJob.validate(j).length === 0);
        return { id, label: labelOf(id), ok: true, count: jobs.length, jobs, error: null };
      } catch (e) {
        return { id, label: labelOf(id), ok: false, count: 0, jobs: [], error: (e && e.message) || 'provider threw' };
      }
    }));

    const raw = outcomes.reduce((all, o) => all.concat(o.jobs), []);
    const filtered = applyFilters(raw, f);
    const dedup = deduplicate(filtered);

    /* score every surviving job against the profile */
    const snapshot = opts.snapshot || JobMatchEngine.snapshotFromProfile(
      (typeof Profile !== 'undefined') ? Profile.getState() : {}
    );
    const jobs = JobMatchEngine.scoreAll(dedup.jobs, snapshot);

    return {
      ok: outcomes.some(o => o.ok),
      jobs,
      providers: outcomes.map(o => ({ id: o.id, label: o.label, ok: o.ok, count: o.count, error: o.error })),
      providersOk: outcomes.filter(o => o.ok).map(o => o.id),
      providersFailed: outcomes.filter(o => !o.ok).map(o => o.id),
      rawCount: raw.length,
      filteredCount: filtered.length,
      duplicatesRemoved: dedup.removed,
      resultCount: jobs.length,
      tookMs: Date.now() - startedAt,
      filters: f,
    };
  }

  /* ---------- Today's Jobs adapter ----------
     The board speaks JobSchema (Sprint 8). Discovery speaks DiscoveryJob.
     This is the only place the two meet, so the board's UI, its decisions,
     its match/GCC/salary rules and every downstream sprint keep working
     against exactly the record shape they already expect. */
  function toBoardJobs(jobs) {
    if (typeof JobSchema === 'undefined') return [];
    return (jobs || []).map(j => {
      const workMode = j.workplaceType === 'On Site' ? 'On-site' : j.workplaceType;   // board's vocabulary
      const salary = j.salary;
      const providers = j.providers || [];
      const rec = JobSchema.normalized({
        id: j.id,
        source: j.provider || providers[0] || 'Unknown',
        sourceJobId: (j.sourceIds || [])[0] || j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        workMode,
        employmentType: j.employmentType || 'Full-time',
        salary: salary ? salary.min : null,
        salaryMax: salary ? salary.max : null,
        salaryDisclosed: !!salary,
        currency: salary ? salary.currency : 'USD',
        salaryPeriod: salary ? salary.period : 'year',
        visaSponsorship: !!j.visaSupport,
        description: j.summary || '',
        skills: j.skills || [],
        applyUrl: j.applyUrl,
        canonicalUrl: j.canonicalUrl,
        postedDate: j.postedDate,
        companyLogo: (j.logo && j.logo.url) || null,
        /* the boards this posting was seen on, in the board's own
           duplicate/provenance fields (Sprint 8B) */
        duplicates: providers.slice(1),
        sources: (j.sourceUrls || []).map((u, i) => ({
          source: providers[i] || j.provider,
          applyUrl: u,
          sourceJobId: (j.sourceIds || [])[i] || null,
          company: j.company,
          postedDate: j.postedDate,
        })),
      });
      /* JobSchema.normalized rebuilds an explicit record, so the discovery-only
         fields are attached afterwards. They are purely additive — nothing that
         existed before reads them. */
      rec.providers = providers.slice();
      rec.confidence = j.confidence;
      rec.discoveryMatch = j.match ? j.match.percentage : null;
      rec.logo = j.logo;
      return rec;
    });
  }

  /* discover → adapt → publish to Today's Jobs. Returns the search result.
     Publishing is what "replaces the static data": JobsStore.setDiscovered()
     is the same channel the daily search has always used, so nothing
     downstream had to change. */
  async function discoverForBoard(filters, options) {
    const res = await search(filters, options);
    if (!res.jobs.length) return res;                    // never blank the board
    const board = toBoardJobs(res.jobs);
    if (typeof JobsStore !== 'undefined') JobsStore.setDiscovered(board);
    return Object.assign({}, res, { published: board.length });
  }

  return {
    /* registry */
    register, unregister, registered, available, instance, reset, labelOf, weightOf,
    /* search */
    normalizeFilters, applyFilters, matchesKeywords, search,
    /* duplicates */
    keyFor, softKeyFor, mergeJobs, deduplicate,
    /* board integration */
    toBoardJobs, discoverForBoard,
  };
})();
