/* ============================================================
   Backend + Migration — storage mode + local→backend migration
   (Sprint 16 PART 5, 6, 8).

   Backend:
     • holds the API base URL + storage mode ('local' | 'backend'),
       persisted to a dedicated localStorage key (NOT the platform
       namespace, so switching providers never loses the setting)
     • testConnection() pings /api/health (+ /api/status)
     • useBackend() swaps AppStorage to the RESTStorageProvider —
       ONLY after a health check succeeds; useLocal() swaps back
     • defaults to LOCAL until the backend is confirmed reachable

   Migration (PART 6):
     • buildBundle() reads existing localStorage domain data into a
       validated, snake_cased API payload (READ-ONLY — never deletes
       local data, never includes file binaries)
     • preview() / migrate() call the backend; the backend import is
       idempotent + duplicate-safe, so re-running is harmless
     • the last migration result is recorded locally

   The frontend defaults to local and only talks to the backend when
   the user opts in from #/admin — no behaviour changes otherwise.
   ============================================================ */

const Backend = (() => {

  const CFG_KEY = 'careerpilot_backend_cfg';
  const DEFAULT_BASE = 'http://127.0.0.1:8000';
  let _status = { reachable: null, apiVersion: null, database: null, environment: null, counts: null, lastPing: null };

  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }

  function baseUrl() { return loadCfg().baseUrl || DEFAULT_BASE; }
  function setBaseUrl(u) { const c = loadCfg(); c.baseUrl = String(u || '').replace(/\/+$/, ''); saveCfg(c); }
  function mode() { return loadCfg().mode === 'backend' ? 'backend' : 'local'; }   // default LOCAL
  function client() { return (typeof APIClient !== 'undefined') ? APIClient : null; }

  async function testConnection(opts) {
    opts = opts || {};
    const c = client();
    if (!c) { _status = { reachable: false, error: 'APIClient unavailable', lastPing: Date.now() }; return _status; }
    try {
      const h = await c.request('GET', baseUrl() + '/api/health', { transport: opts.transport, retries: 0, timeout: 6000 });
      const ok = !!(h && h.ok && h.data);
      _status = { reachable: ok, apiVersion: h.data && h.data.api_version, database: null, environment: null, counts: null, lastPing: Date.now() };
      if (ok) {
        try {
          const s = await c.request('GET', baseUrl() + '/api/status', { transport: opts.transport, retries: 0, timeout: 6000 });
          if (s && s.data) { _status.database = s.data.database; _status.environment = s.data.environment; _status.counts = s.data.counts; }
        } catch (e) { /* status optional */ }
      }
      return _status;
    } catch (e) {
      _status = { reachable: false, error: (e && e.message) || 'unreachable', lastPing: Date.now() };
      return _status;
    }
  }

  function useBackend(opts) {
    opts = opts || {};
    if (typeof StorageProviders === 'undefined' || typeof AppStorage === 'undefined') return null;
    const provider = StorageProviders.create('rest', { baseUrl: baseUrl(), transport: opts.transport || null });
    AppStorage.use(provider);
    const c = loadCfg(); c.mode = 'backend'; saveCfg(c);
    return provider;
  }
  function useLocal() {
    if (typeof StorageProviders !== 'undefined' && typeof AppStorage !== 'undefined') {
      AppStorage.use(StorageProviders.create('local', { namespace: 'careerpilot_platform.' }));
    }
    const c = loadCfg(); c.mode = 'local'; saveCfg(c);
  }

  function status() { return Object.assign({ mode: mode(), baseUrl: baseUrl() }, _status); }

  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function' && currentRoute() === 'admin') navigate();
  }

  /* admin button: test connection, then (if reachable) offer backend mode */
  async function adminTest() {
    const s = await testConnection();
    if (typeof toast === 'function') {
      toast(s.reachable ? `Backend reachable — API v${s.apiVersion || '?'} · DB ${s.database || 'ok'}` : `Backend unreachable at ${baseUrl()}`, s.reachable ? 'success' : 'error');
    }
    refresh();
    return s;
  }

  return { CFG_KEY, DEFAULT_BASE, loadCfg, saveCfg, baseUrl, setBaseUrl, mode, client, testConnection, useBackend, useLocal, status, adminTest, refresh };
})();


const Migration = (() => {

  const LAST_KEY = 'careerpilot_migration_last';

  /* READ-ONLY: shape existing localStorage domain data into the API
     bundle. Never mutates or deletes anything; excludes file binaries. */
  function buildBundle() {
    const b = { profile: null, preferences: null, employment: [], skills: [], certifications: [], jobs: [], decisions: [], packages: [], submitted: [], interviews: [] };
    try {
      const p = (typeof ProfileStore !== 'undefined') ? ProfileStore.load() : null;
      if (p) {
        b.profile = {
          first_name: p.personal.firstName, last_name: p.personal.lastName, headline: p.personal.headline, summary: p.personal.summary,
          email: p.contact.email, phone: p.contact.phone, city: p.contact.city, country: p.contact.country,
          links: p.links || {}, authorization: p.authorization || {},
        };
        b.preferences = {
          target_roles: p.preferences.targetRoles, locations: p.preferences.locations, min_salary: p.preferences.minSalary,
          monthly_min_sar: p.preferences.monthlyMinSAR, monthly_min_aed: p.preferences.monthlyMinAED,
          work_mode: p.preferences.workMode, outside_gcc_mode: p.preferences.outsideGccMode, job_type: p.preferences.jobType, relocation: !!p.preferences.relocation,
        };
        if (p.employment && (p.employment.company || '').trim()) {
          b.employment.push({ ext_id: 'emp-current', company: p.employment.company, title: p.employment.title, start_date: p.employment.startDate, is_current: !!p.employment.current, highlights: p.employment.highlights, source: 'manual' });
        }
        (p.history || []).forEach(h => b.employment.push({ ext_id: h.id, company: h.company, title: h.title, location: h.location, start_date: h.startDate, end_date: h.endDate, is_current: !!h.current, highlights: h.highlights, source: h.source || 'manual' }));
        b.skills = (p.skills || []).slice();
        b.certifications = (p.certifications || []).filter(c => c && c.name).map(c => ({ name: c.name, issuer: c.issuer, year: c.year }));
      }
    } catch (e) { /* profile optional */ }

    try {
      if (typeof PrepStore !== 'undefined') PrepStore.all().forEach(pk => {
        b.packages.push({ job_key: pk.jobId, version: pk.v, status: pk.status, match_score: pk.matchScore, resume_safety: pk.resume && pk.resume.safety ? pk.resume.safety.score : null, resume: pk.resume, cover_letter: pk.coverLetter, answers: pk.answers, missing_info: pk.missingInfo, blockers: pk.blockers, source_url: pk.sourceUrl });
        const j = pk.job;
        if (j) b.jobs.push({ ext_id: j.id, source: j.source, source_job_id: j.sourceJobId, title: j.title, company: j.company, location: j.location, work_mode: j.workMode, employment_type: j.employmentType, salary: j.salary, salary_disclosed: !!j.salaryDisclosed, currency: j.currency, description: j.description, skills: j.skills, apply_url: j.applyUrl, canonical_url: j.canonicalUrl, posted_date: j.postedDate });
      });
    } catch (e) { /* packages optional */ }

    try {
      if (typeof SubmissionStore !== 'undefined') SubmissionStore.all().filter(r => r.status === 'submitted').forEach(r =>
        b.submitted.push({ job_key: r.jobId, submission_id: r.confirmationId, submitter: r.submitter, status: r.status, snapshot: r.snapshot }));
    } catch (e) { /* submitted optional */ }

    try {
      if (typeof ApplicationMemory !== 'undefined') ApplicationMemory.all().forEach(m =>
        b.interviews.push({ job_key: m.jobId, company: m.company, role: m.role, submission_id: m.submissionId, status: m.status, submitted: m.submitted, interview: m.interview, recruiter_notes: m.recruiterNotes, follow_up_date: m.followUpDate, notes: m.notes, events: m.events, mock: m.mock }));
    } catch (e) { /* interviews optional */ }

    return b;
  }

  function counts() {
    const b = buildBundle();
    return { profile: b.profile ? 1 : 0, preferences: b.preferences ? 1 : 0, employment: b.employment.length, skills: b.skills.length, certifications: b.certifications.length, jobs: b.jobs.length, packages: b.packages.length, submitted: b.submitted.length, interviews: b.interviews.length };
  }

  async function preview(opts) {
    opts = opts || {};
    const c = Backend.client(); if (!c) throw new Error('APIClient unavailable');
    const r = await c.request('POST', Backend.baseUrl() + '/api/migrate/preview', { transport: opts.transport, retries: 0, timeout: 8000, body: buildBundle() });
    return r.data;
  }

  async function migrate(opts) {
    opts = opts || {};
    const c = Backend.client(); if (!c) throw new Error('APIClient unavailable');
    const r = await c.request('POST', Backend.baseUrl() + '/api/migrate', { transport: opts.transport, retries: 0, timeout: 20000, body: buildBundle() });
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), result: r.data })); } catch (e) { /* ignore */ }
    return r.data;   /* local data is untouched — migration only READS it */
  }

  function lastMigration() { try { return JSON.parse(localStorage.getItem(LAST_KEY)); } catch (e) { return null; } }

  /* admin button: explicit, confirmed migration */
  async function adminMigrate() {
    if (typeof confirm === 'function' && !confirm('Migrate your local CareerPilot data to the backend?\n\nThis COPIES data — nothing is deleted locally. Re-running is safe (duplicates are skipped).')) return null;
    try {
      const res = await migrate();
      if (typeof toast === 'function') toast(`Migrated ${res.success_count} · skipped ${res.skipped_count} · failed ${res.failed_count}`, res.failed_count ? 'error' : 'success');
      Backend.refresh();
      return res;
    } catch (e) {
      if (typeof toast === 'function') toast('Migration failed — ' + ((e && e.message) || 'backend unreachable'), 'error');
      return null;
    }
  }

  return { LAST_KEY, buildBundle, counts, preview, migrate, lastMigration, adminMigrate };
})();
