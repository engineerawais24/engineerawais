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

  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function' && currentRoute() === 'admin') navigate();
  }

  /* ---- in-flight guards: the admin disables a button while its
     action is already running (Sprint 17 PART 5) ---- */
  const busy = { test: false, hydrate: false, sync: false, retry: false, mode: false };
  function isBusy(k) { return k ? !!busy[k] : Object.keys(busy).some(x => busy[x]); }
  async function guarded(key, fn) {
    if (busy[key]) return { skipped: true, reason: 'in_progress' };
    busy[key] = true; refresh();
    try { return await fn(); } finally { busy[key] = false; refresh(); }
  }

  function provider() {
    const p = (typeof AppStorage !== 'undefined') ? AppStorage.active() : null;
    return (p && p.kind === 'rest') ? p : null;
  }

  function status() {
    const p = provider();
    const sync = (typeof SyncManager !== 'undefined') ? SyncManager.status() : {};
    return Object.assign({
      mode: mode(),
      baseUrl: baseUrl(),
      hydration: p && p.hydration ? p.hydration() : null,
      sync,
      conflicts: (typeof ConflictCenter !== 'undefined') ? ConflictCenter.count() : 0,
      busy: Object.assign({}, busy),
      compare: (typeof DomainSync !== 'undefined') ? DomainSync.compare() : null,
    }, _status);
  }

  /* ---- HYDRATION: pull backend state into the local mirror ----
     Local unsynced writes are always preserved (see RESTStorageProvider). */
  async function hydrate(opts) {
    opts = opts || {};
    const p = provider();
    if (!p) return { ok: false, error: 'backend mode is not active' };
    const kv = await p.hydrate(opts);
    let domain = null;
    if (typeof DomainSync !== 'undefined') {
      try { domain = await DomainSync.hydrateAll(opts); } catch (e) { domain = { ok: false, error: e.message }; }
    }
    return { ok: !!kv.ok, kv, domain };
  }

  /* ---- FLUSH: drain the offline queue to the backend ---- */
  async function syncNow(opts) {
    if (typeof SyncManager === 'undefined') return { ok: false, error: 'SyncManager unavailable' };
    const r = await SyncManager.flushNow(opts || {});
    if (typeof DomainSync !== 'undefined' && mode() === 'backend') {
      try { await DomainSync.pushAll(opts || {}); } catch (e) { /* queued by DomainSync */ }
    }
    return r;
  }

  /* ---- MODE SWITCHING ---- */
  /* Backend mode ALWAYS tests connectivity first. On success it swaps the
     provider, marks sync online, hydrates and flushes the queue. */
  async function enableBackendMode(opts) {
    opts = opts || {};
    const s = await testConnection(opts);
    if (!s.reachable) return { ok: false, reachable: false, error: 'Backend unreachable — staying in local mode' };
    useBackend(opts);
    if (typeof SyncManager !== 'undefined') SyncManager.setOnline(true);
    const h = await hydrate(opts);
    const f = await syncNow(opts);
    return { ok: true, reachable: true, hydrate: h, flush: f };
  }

  /* Local mode NEVER deletes backend or local data — it only swaps the
     active provider back to the local mirror. */
  function enableLocalMode() {
    useLocal();
    if (typeof SyncManager !== 'undefined') SyncManager.setOnline(false);
    return { ok: true, mode: 'local' };
  }

  /* ---- TRIGGERS (PART 1) ---- */
  async function onOnline() {                      // browser came online
    if (mode() !== 'backend') return { skipped: true };
    const s = await testConnection();
    if (!s.reachable) return { skipped: true, reachable: false };
    if (typeof SyncManager !== 'undefined') SyncManager.setOnline(true);
    return syncNow();
  }

  async function boot() {                          // app start, backend mode was on
    if (mode() !== 'backend') return { skipped: true, mode: 'local' };
    const s = await testConnection();
    if (!s.reachable) {
      if (typeof SyncManager !== 'undefined') SyncManager.setOnline(false);
      return { skipped: true, reachable: false };  // stay on the mirror, fully usable
    }
    useBackend({});
    if (typeof SyncManager !== 'undefined') SyncManager.setOnline(true);
    const h = await hydrate();
    const f = await syncNow();
    return { ok: true, hydrate: h, flush: f };
  }

  /* ---- ADMIN BUTTON ACTIONS (guarded + toasted) ---- */
  function say(msg, type) { if (typeof toast === 'function') toast(msg, type); }

  function adminTest() {
    return guarded('test', async () => {
      const s = await testConnection();
      say(s.reachable ? `Backend reachable — API v${s.apiVersion || '?'} · DB ${s.database || 'ok'}` : `Backend unreachable at ${baseUrl()}`, s.reachable ? 'success' : 'error');
      if (s.reachable && mode() === 'backend' && typeof SyncManager !== 'undefined') {
        SyncManager.setOnline(true);
        await syncNow();                       // trigger: connection test succeeded
      }
      return s;
    });
  }

  function adminHydrate() {
    return guarded('hydrate', async () => {
      if (mode() !== 'backend') { say('Switch to backend mode first — hydration only runs in backend mode', 'error'); return { ok: false }; }
      if (typeof confirm === 'function' && !confirm('Hydrate from the backend?\n\nBackend data is merged INTO your local mirror. Any local change that has not been synced yet is PRESERVED (it wins, and the difference is recorded as a conflict). Nothing local is deleted.')) return { skipped: true };
      const r = await hydrate();
      const kv = r.kv || {};
      say(r.ok ? `Hydrated — ${kv.applied || 0} key(s) applied, ${kv.skipped || 0} local write(s) kept, ${kv.conflicts || 0} conflict(s)` : `Hydration failed — still using the local mirror (${(kv && kv.error) || 'unreachable'})`, r.ok ? 'success' : 'error');
      return r;
    });
  }

  function adminSyncNow() {
    return guarded('sync', async () => {
      if (typeof SyncManager !== 'undefined' && mode() === 'backend') SyncManager.setOnline(true);
      const r = await syncNow();
      if (r && r.skipped) say(r.reason === 'in_progress' ? 'A sync is already running' : 'Offline — operations stay queued', 'info');
      else say(`Sync — ${r.synced || 0} sent, ${r.failed || 0} failed, ${r.conflicts || 0} conflict(s), ${r.pending || 0} still queued`, (r.failed || r.conflicts) ? 'error' : 'success');
      return r;
    });
  }

  function adminRetryFailed() {
    return guarded('retry', async () => {
      if (typeof SyncManager === 'undefined') return { ok: false };
      const n = SyncManager.retry();
      if (!n) { say('No failed operations to retry', 'info'); return { ok: true, rearmed: 0 }; }
      const r = await syncNow();
      say(`Retried ${n} operation(s) — ${r.synced || 0} succeeded, ${r.pending || 0} still queued`, (r.synced) ? 'success' : 'error');
      return Object.assign({ rearmed: n }, r);
    });
  }

  function adminUseBackend() {
    return guarded('mode', async () => {
      const r = await enableBackendMode();
      say(r.ok ? 'Backend mode ON — hydrated and queue flushed' : (r.error || 'Could not enable backend mode'), r.ok ? 'success' : 'error');
      return r;
    });
  }

  function adminUseLocal() {
    return guarded('mode', async () => {
      const r = enableLocalMode();
      say('Local mode ON — nothing was deleted locally or on the backend', 'success');
      return r;
    });
  }

  return {
    CFG_KEY, DEFAULT_BASE, loadCfg, saveCfg, baseUrl, setBaseUrl, mode, client,
    testConnection, useBackend, useLocal, provider, status, refresh,
    hydrate, syncNow, enableBackendMode, enableLocalMode, onOnline, boot,
    isBusy, adminTest, adminHydrate, adminSyncNow, adminRetryFailed, adminUseBackend, adminUseLocal,
  };
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
