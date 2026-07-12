/* ============================================================
   ImportedJobs — manually imported real job opportunities
   (Sprint 26).

   The user pastes a real posting's URL and details; CareerPilot
   stores it, scores it and carries it through the existing
   review → approve → application flow.

   NOTHING here fetches, scrapes or calls a job board. The URL is
   validated as a string and stored as a link; the page behind it is
   never requested. Every field comes from the user.

   Reuse, not reinvention:
     • scoring   → JobMatchEngine (Sprint 25). No second scorer.
     • the model → BaseProvider.unified + DiscoveryJob (Sprint 25).
     • the board → JobSchema (Sprint 8).
     • the app   → ApplicationPackages (Sprint 23/24).
     • storage   → AppStorage, the same platform layer as Sprints 19–24.
   ============================================================ */

const ImportedJobs = (() => {

  const STORAGE_KEY = 'imported_jobs';

  const STATUSES = ['new', 'shortlisted', 'rejected', 'approved'];
  const STATUS_LABEL = { new: 'New', shortlisted: 'Shortlisted', rejected: 'Rejected', approved: 'Approved' };
  const WORKPLACES = ['Remote', 'Hybrid', 'On Site'];
  const DEFAULT_SOURCE = 'Imported';

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();
  const trim = s => String(s == null ? '' : s).trim();
  const today = () => new Date().toISOString().slice(0, 10);

  function isValidStatus(s) { return STATUSES.indexOf(s) !== -1; }
  function statusLabel(s) { return STATUS_LABEL[s] || s; }

  /* ---------- storage (the existing platform layer) ---------- */

  function all() {
    const list = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    return Array.isArray(list) ? list : [];
  }
  function persist(list) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, list);
    return list;
  }
  function get(id) { return all().find(j => j.id === id) || null; }

  /* the default view hides rejected jobs; they are kept, not deleted */
  function active() { return all().filter(j => j.status !== 'rejected'); }
  function rejected() { return all().filter(j => j.status === 'rejected'); }
  function byStatus(status) { return all().filter(j => j.status === status); }

  /* ---------- URL handling (never fetched) ---------- */

  function isValidUrl(url) {
    const u = trim(url);
    if (!u) return false;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
      return !!parsed.hostname && parsed.hostname.indexOf('.') !== -1;
    } catch (e) {
      return false;
    }
  }

  function canonical(url) {
    return (typeof BaseProvider !== 'undefined')
      ? BaseProvider.canonicalUrl(url)
      : lc(url).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0].replace(/\/+$/, '');
  }

  /* the same posting twice — compared on the canonical URL, so tracking
     params and a trailing slash don't sneak a duplicate through */
  function findByUrl(url, ignoreId) {
    const key = canonical(url);
    if (!key) return null;
    return all().find(j => j.canonicalUrl === key && j.id !== ignoreId) || null;
  }

  /* ---------- validation (inline, field by field) ---------- */

  const REQUIRED = [
    ['title', 'Job title is required'],
    ['company', 'Company is required'],
    ['url', 'Job URL is required'],
    ['description', 'Job description is required'],
  ];

  function validate(input, opts) {
    const src = input || {};
    const o = opts || {};
    const errors = {};

    REQUIRED.forEach(([field, message]) => {
      if (!trim(src[field])) errors[field] = message;
    });

    if (!errors.url) {
      if (!isValidUrl(src.url)) {
        errors.url = 'Enter a valid job URL, starting with http:// or https://';
      } else if (findByUrl(src.url, o.ignoreId)) {
        const dup = findByUrl(src.url, o.ignoreId);
        errors.url = `Already imported — “${dup.title}” at ${dup.company}`;
      }
    }

    const salary = src.salary;
    if (salary !== '' && salary != null && (isNaN(Number(salary)) || Number(salary) < 0)) {
      errors.salary = 'Salary must be a number (annual, in thousands)';
    }
    if (trim(src.postedDate) && !/^\d{4}-\d{2}-\d{2}$/.test(trim(src.postedDate))) {
      errors.postedDate = 'Posted date must be YYYY-MM-DD';
    }

    return { ok: Object.keys(errors).length === 0, errors };
  }

  /* ---------- required skills ----------
     The form deliberately has no "skills" field — the user pastes the real
     description and we read the skills out of it. The vocabulary is drawn
     from data the app already holds (the profile, the sample postings and
     the résumé role families), so nothing is invented and no skill is
     claimed that the app doesn't already know about. */
  function vocabulary() {
    const seen = new Set();
    const add = s => { const t = trim(s); if (t) seen.add(t); };
    if (typeof Profile !== 'undefined') (Profile.getState().skills || []).forEach(add);
    if (typeof JobsStore !== 'undefined') JobsStore.jobs().forEach(j => (j.skills || []).forEach(add));
    if (typeof ResumesStore !== 'undefined' && ResumesStore.keywordsFor) {
      ['architect', 'consultant', 'implementation', 'engineer'].forEach(family =>
        ResumesStore.keywordsFor(family).forEach(add));
    }
    return Array.from(seen);
  }

  function extractSkills(text) {
    const hay = ' ' + lc(text) + ' ';
    return vocabulary().filter(skill => hay.indexOf(lc(skill)) !== -1);
  }

  /* ---------- create ---------- */

  function create(input) {
    const src = input || {};
    const v = validate(src);
    if (!v.ok) return { ok: false, errors: v.errors };

    const url = trim(src.url);
    const title = trim(src.title);
    const description = trim(src.description);
    const salary = (src.salary === '' || src.salary == null) ? null : Number(src.salary);

    const job = {
      id: 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      url,
      canonicalUrl: canonical(url),
      title,
      company: trim(src.company),
      location: trim(src.location),
      workplaceType: WORKPLACES.indexOf(src.workplaceType) !== -1 ? src.workplaceType : 'On Site',
      /* "Imported" when the user names no source */
      source: trim(src.source) || DEFAULT_SOURCE,
      description,
      salary,
      currency: trim(src.currency) || 'USD',
      postedDate: trim(src.postedDate) || null,
      skills: extractSkills(title + ' ' + description),
      status: 'new',
      statusChangedOn: null,
      createdAt: Date.now(),
      createdOn: today(),
    };

    persist(all().concat([job]));
    return { ok: true, job };
  }

  /* ---------- review status ---------- */

  function setStatus(id, status) {
    if (!isValidStatus(status)) return null;          // invalid → no change at all
    const list = all();
    const job = list.find(j => j.id === id);
    if (!job) return null;
    if (job.status === status) return job;
    job.status = status;
    job.statusChangedOn = today();
    job.statusChangedAt = Date.now();
    persist(list);
    return job;
  }

  function remove(id) {
    const list = all();
    if (!list.some(j => j.id === id)) return false;
    persist(list.filter(j => j.id !== id));
    return true;
  }
  function clear() { persist([]); }

  /* ---------- scoring: the EXISTING Sprint 25 engine ---------- */

  /* an imported job in the discovery model, so JobMatchEngine can score it
     exactly as it scores a discovered one */
  function toDiscoveryJob(job) {
    const unified = BaseProvider.unified({
      id: job.id,
      sourceId: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      workMode: job.workplaceType === 'On Site' ? 'On-site' : job.workplaceType,
      skills: job.skills || [],
      description: job.description,
      url: job.url,
      postedAt: job.postedDate,
      provider: job.source || DEFAULT_SOURCE,
      salaryMin: job.salary,
      currency: job.currency || 'USD',
      salaryPeriod: 'year',
    });
    /* a hand-entered posting is unverified, so it carries a lower provider
       weight than a board feed — it affects confidence, never the match */
    return DiscoveryJob.from(unified, { providerWeight: 0.6 });
  }

  function match(job, snapshot) {
    if (typeof JobMatchEngine === 'undefined') return null;
    return JobMatchEngine.score(toDiscoveryJob(job), snapshot);
  }

  /* a one-line, honest explanation of the score */
  function explain(m) {
    if (!m) return '';
    if (m.reasons && m.reasons.length) return m.reasons.slice(0, 2).join(' · ');
    return 'Scored against your profile — no strong signals matched.';
  }

  /* ---------- the application (the EXISTING Sprint 23 package) ---------- */

  /* the imported job in the board's own schema, so an application package
     is built from exactly the record shape everything downstream expects */
  function toBoardJob(job) {
    return JobSchema.normalized({
      id: job.id,
      source: job.source || DEFAULT_SOURCE,
      sourceJobId: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      workMode: job.workplaceType === 'On Site' ? 'On-site' : job.workplaceType,
      employmentType: 'Full-time',
      salary: job.salary,
      salaryDisclosed: job.salary != null,
      currency: job.currency || 'USD',
      salaryPeriod: 'year',
      description: job.description,
      skills: job.skills || [],
      applyUrl: job.url,
      canonicalUrl: job.canonicalUrl,
      postedDate: job.postedDate || job.createdOn,
    });
  }

  function hasApplication(id) {
    return (typeof ApplicationPackages !== 'undefined') && !!ApplicationPackages.forJob(id);
  }

  /* Only an APPROVED job becomes an application, and only once. */
  function createApplication(id, snapshot) {
    const job = get(id);
    if (!job) return { ok: false, error: 'That imported job no longer exists' };
    if (job.status !== 'approved') return { ok: false, error: 'Approve the job before creating an application' };
    if (typeof ApplicationPackages === 'undefined') return { ok: false, error: 'The applications module is not available' };

    const existing = ApplicationPackages.forJob(job.id);
    if (existing) return { ok: false, error: 'An application already exists for this job', pkg: existing };

    const m = match(job, snapshot);
    const pkg = ApplicationPackages.createFrom({
      job: toBoardJob(job),
      res: { score: m ? m.percentage : null },
    });
    return { ok: true, pkg };
  }

  return {
    STORAGE_KEY, STATUSES, STATUS_LABEL, WORKPLACES, DEFAULT_SOURCE,
    all, active, rejected, byStatus, get, remove, clear,
    isValidUrl, canonical, findByUrl, validate, isValidStatus, statusLabel,
    vocabulary, extractSkills,
    create, setStatus,
    toDiscoveryJob, match, explain,
    toBoardJob, hasApplication, createApplication,
  };
})();
