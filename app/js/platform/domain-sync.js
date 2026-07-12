/* ============================================================
   DomainSync — two-way domain persistence adapter (Sprint 17 PART 3).

   Sits BEHIND the existing stores (ProfileStore, PrepStore,
   SubmissionStore, ApplicationMemory, Connectors). No UI module is
   rewritten and no public API changes: DomainSync only READS them to
   push, and writes back through their own persistence APIs on hydrate.

   PUSH (backend mode, async, never blocks the UI):
     profile · preferences · employment · jobs · job decisions ·
     application packages · submitted applications · interviews ·
     connector statuses
     • network/5xx failure → the write is QUEUED on SyncManager
       (entity 'domain') and retried on the next flush
     • 409 on an IMMUTABLE record (submitted / interview.submitted):
       the backend copy is compared with the local one; if it differs
       a PROVENANCE conflict is recorded and the backend is NEVER
       overwritten. If identical it is simply already-synced.
     • interviews: after a 409 the MUTABLE tracking fields are PATCHed
       (status/date/notes/follow-up/mock) — `submitted` is never sent.

   HYDRATE (this sprint): profile + preferences are merged back into
   the local stores FILL-IF-EMPTY (a populated local store always
   wins; a difference is recorded as a conflict, never overwritten).
   The remaining entities are fetched into a read-only backend
   snapshot used for the admin local/backend comparison. See
   "Known limitations" in backend/README.md.
   ============================================================ */

const DomainSync = (() => {

  const SNAPSHOT_KEY = 'domain_backend_snapshot';
  const STATE_KEY = 'domain_sync_state';
  const IMMUTABLE = ['submitted', 'interviews'];

  function api() { return (typeof APIClient !== 'undefined') ? APIClient : null; }
  function base() { return (typeof Backend !== 'undefined') ? Backend.baseUrl() : ''; }

  async function req(method, path, body, o) {
    const c = api();
    if (!c) throw new Error('APIClient unavailable');
    const opts = { transport: o && o.transport, retries: 0, timeout: (o && o.timeout) || 12000 };
    if (body != null) opts.body = body;
    return c.request(method, base() + path, opts);
  }

  /* ---------- what to push (read-only shaping) ---------- */
  function bundle() { return (typeof Migration !== 'undefined') ? Migration.buildBundle() : null; }

  /* jobs carry the FULL normalized record in `raw` so a future sprint
     can rebuild packages from the backend without guessing. */
  function jobsWithRaw() {
    const out = [];
    try {
      if (typeof PrepStore === 'undefined') return out;
      PrepStore.all().forEach(pk => {
        const j = pk.job;
        if (!j) return;
        out.push({
          ext_id: j.id, source: j.source, source_job_id: j.sourceJobId, title: j.title, company: j.company,
          location: j.location, work_mode: j.workMode, employment_type: j.employmentType,
          salary: String(j.salary == null ? '' : j.salary), salary_disclosed: !!j.salaryDisclosed,
          currency: j.currency, description: j.description, skills: j.skills || [],
          apply_url: j.applyUrl, canonical_url: j.canonicalUrl, posted_date: j.postedDate,
          raw: j,
        });
      });
    } catch (e) { /* optional */ }
    return out;
  }

  function decisions() {
    const out = [];
    try {
      if (typeof PrepStore === 'undefined') return out;
      PrepStore.all().forEach(pk => {
        if (!pk.decision) return;
        out.push({
          job_ext_id: pk.jobId, outcome: pk.decision.outcome || '', recommendation: pk.decision.recommendation || '',
          confidence: pk.decision.confidence || '', reasons: pk.decision.reasons || [],
        });
      });
    } catch (e) { /* optional */ }
    return out;
  }

  function connectorRows() {
    const out = [];
    try {
      if (typeof Connectors === 'undefined') return out;
      Connectors.all().forEach(a => {
        const h = a.healthCheck();
        out.push({
          connector_id: h.id, label: h.label || '', status: h.status || h.health || 'healthy',
          jobs_retrieved: h.jobsRetrieved || 0, retries: h.retries || 0,
          avg_response_ms: h.avgResponseTime || 0, last_error: h.lastError || '',
        });
      });
    } catch (e) { /* optional */ }
    return out;
  }

  /* ---------- push ---------- */
  function queueOp(entity, key, method, path, body) {
    if (typeof SyncManager !== 'undefined') {
      SyncManager.enqueue({ type: 'set', entity: 'domain', key: entity + ':' + key, payload: { method, path, body }, optimistic: true });
    }
  }

  /* returns 'ok' | 'exists' | 'conflict' | 'failed' | 'queued' */
  async function pushOne(entity, key, method, path, body, o) {
    try {
      await req(method, path, body, o);
      return 'ok';
    } catch (e) {
      const st = e && e.status;
      if (st === 409) return 'conflict';
      if (st != null && st >= 400 && st < 500) {
        if (typeof ErrorCenter !== 'undefined') ErrorCenter.record({ category: 'sync', message: e.message, source: entity + ':' + key, severity: 'error', retryable: false, technical: { status: st } });
        return 'failed';
      }
      queueOp(entity, key, method, path, body);   // network / 5xx → retry later
      return 'queued';
    }
  }

  /* an immutable record already exists on the backend: compare, never overwrite */
  async function reconcileImmutable(entity, key, path, localFrozen, o) {
    let backend = null;
    try {
      const res = await req('GET', path, null, o);
      backend = res && res.data ? res.data : null;
    } catch (e) { /* can't read → treat as unknown */ }
    const backendFrozen = backend ? (entity === 'submitted' ? backend.snapshot : backend.submitted) : null;
    const same = JSON.stringify(backendFrozen || null) === JSON.stringify(localFrozen || null);
    if (!same && typeof ConflictCenter !== 'undefined') {
      ConflictCenter.record({
        entity, key, kind: 'provenance',
        message: `Backend already holds a different immutable ${entity} record — backend NOT overwritten, local kept`,
        local: localFrozen, backend: backendFrozen,
      });
    }
    return same ? 'exists' : 'conflict';
  }

  async function pushAll(o) {
    o = o || {};
    const b = bundle();
    if (!b) return { ok: false, error: 'no local data' };
    /* pushOne returns 'ok' — counted as `succeeded` so it never collides
       with the boolean `ok` on the returned result object. */
    const res = { succeeded: 0, exists: 0, conflict: 0, failed: 0, queued: 0, byEntity: {} };
    const tally = (ent, r) => {
      const k = (r === 'ok') ? 'succeeded' : r;
      if (res[k] == null) res[k] = 0;
      res[k]++;
      const e = res.byEntity[ent] || (res.byEntity[ent] = { succeeded: 0, exists: 0, conflict: 0, failed: 0, queued: 0 });
      e[k] = (e[k] || 0) + 1;
    };

    if (b.profile) tally('profile', await pushOne('profile', 'me', 'PUT', '/api/profile', b.profile, o));
    if (b.preferences) tally('preferences', await pushOne('preferences', 'me', 'PUT', '/api/preferences', b.preferences, o));

    for (const e of b.employment) {
      let r = await pushOne('employment', e.ext_id || e.company, 'POST', '/api/employment', e, o);
      if (r === 'conflict') r = 'exists';                    // already present — not a real conflict
      tally('employment', r);
    }
    for (const j of jobsWithRaw()) {
      let r = await pushOne('jobs', j.ext_id, 'POST', '/api/jobs', j, o);
      if (r === 'conflict') r = 'exists';
      tally('jobs', r);
    }
    for (const d of decisions()) {
      tally('decisions', await pushOne('decisions', d.job_ext_id, 'POST', '/api/jobs/decisions', d, o));
    }
    for (const p of b.packages) {
      tally('packages', await pushOne('packages', p.job_key, 'POST', '/api/applications/packages', p, o));
    }

    /* IMMUTABLE — provenance is never overwritten */
    for (const s of b.submitted) {
      let r = await pushOne('submitted', s.job_key, 'POST', '/api/applications/submitted', s, o);
      if (r === 'conflict') {
        r = await reconcileImmutable('submitted', s.job_key, '/api/applications/submitted/' + encodeURIComponent(s.job_key), s.snapshot, o);
      }
      tally('submitted', r);
    }
    for (const iv of b.interviews) {
      let r = await pushOne('interviews', iv.job_key, 'POST', '/api/interviews', iv, o);
      if (r === 'conflict') {
        r = await reconcileImmutable('interviews', iv.job_key, '/api/interviews/' + encodeURIComponent(iv.job_key), iv.submitted, o);
        /* the MUTABLE tracking fields are still synced — never `submitted` */
        const patch = {
          status: iv.status, interview: iv.interview, recruiter_notes: iv.recruiter_notes,
          follow_up_date: iv.follow_up_date, notes: iv.notes, events: iv.events, mock: iv.mock,
        };
        const pr = await pushOne('interviews', iv.job_key, 'PATCH', '/api/interviews/' + encodeURIComponent(iv.job_key), patch, o);
        if (pr === 'queued' || pr === 'failed') r = pr;
      }
      tally('interviews', r);
    }
    for (const c of connectorRows()) {
      tally('connectors', await pushOne('connectors', c.connector_id, 'POST', '/api/connectors', c, o));
    }

    saveState({ lastPushAt: Date.now(), lastPush: res });
    return Object.assign({ ok: true }, res);
  }

  /* ---------- hydrate ---------- */
  function localProfileMissing() {
    try { return typeof ProfileStore !== 'undefined' && localStorage.getItem(ProfileStore.KEY) === null; }
    catch (e) { return false; }
  }

  async function hydrateAll(o) {
    o = o || {};
    const started = Date.now();
    const out = { ok: true, at: Date.now(), filled: [], kept: [], conflicts: 0, snapshot: {}, errors: [] };
    const snap = {};

    /* read every supported collection into a backend snapshot (read-only) */
    const reads = [
      ['profile', '/api/profile'], ['preferences', '/api/preferences'], ['employment', '/api/employment'],
      ['jobs', '/api/jobs'], ['packages', '/api/applications/packages'],
      ['submitted', '/api/applications/submitted'], ['interviews', '/api/interviews'],
      ['connectors', '/api/connectors'],
    ];
    for (const [name, path] of reads) {
      try { const r = await req('GET', path, null, o); snap[name] = r && r.data ? r.data : null; }
      catch (e) { out.errors.push({ entity: name, error: (e && e.message) || 'read failed' }); }
    }
    out.snapshot = snap;

    /* profile + preferences: FILL-IF-EMPTY. A populated local store always
       wins; any difference is recorded as a conflict and never overwritten. */
    try {
      if (typeof ProfileStore !== 'undefined' && snap.profile) {
        const empty = localProfileMissing();
        const p = ProfileStore.load();
        const bp = snap.profile;
        if (empty) {
          p.personal.firstName = bp.first_name || p.personal.firstName;
          p.personal.lastName = bp.last_name || p.personal.lastName;
          p.personal.headline = bp.headline || p.personal.headline;
          p.personal.summary = bp.summary || p.personal.summary;
          p.contact.email = bp.email || p.contact.email;
          p.contact.phone = bp.phone || p.contact.phone;
          p.contact.city = bp.city || p.contact.city;
          p.contact.country = bp.country || p.contact.country;
          if (bp.links) Object.assign(p.links, bp.links);
          if (bp.authorization) Object.assign(p.authorization, bp.authorization);
          if (snap.preferences) {
            const bq = snap.preferences;
            p.preferences.targetRoles = bq.target_roles || p.preferences.targetRoles;
            p.preferences.locations = bq.locations || p.preferences.locations;
            p.preferences.minSalary = bq.min_salary || p.preferences.minSalary;
            p.preferences.workMode = bq.work_mode || p.preferences.workMode;
            p.preferences.outsideGccMode = bq.outside_gcc_mode || p.preferences.outsideGccMode;
            p.preferences.jobType = bq.job_type || p.preferences.jobType;
          }
          ProfileStore.save(p);
          out.filled.push('profile', 'preferences');
        } else {
          const differs = (bp.first_name || '') !== (p.personal.firstName || '') || (bp.city || '') !== (p.contact.city || '');
          if (differs) {
            out.kept.push('profile'); out.conflicts++;
            if (typeof ConflictCenter !== 'undefined') {
              ConflictCenter.record({
                entity: 'profile', key: 'me', kind: 'version',
                message: 'Local profile differs from the backend — local kept (backend version retained here)',
                local: { first_name: p.personal.firstName, city: p.contact.city },
                backend: { first_name: bp.first_name, city: bp.city },
              });
            }
          } else { out.kept.push('profile'); }
        }
      }
    } catch (e) { out.errors.push({ entity: 'profile', error: (e && e.message) || 'merge failed' }); }

    if (typeof AppStorage !== 'undefined') AppStorage.set(SNAPSHOT_KEY, { at: Date.now(), snapshot: snap });
    saveState({ lastHydrateAt: Date.now(), lastHydrate: { filled: out.filled, kept: out.kept, conflicts: out.conflicts, errors: out.errors.length } });
    out.durationMs = Date.now() - started;
    out.ok = out.errors.length === 0;
    return out;
  }

  /* ---------- state + comparison ---------- */
  function loadState() { return ((typeof AppStorage !== 'undefined') ? AppStorage.get(STATE_KEY) : null) || {}; }
  function saveState(patch) {
    if (typeof AppStorage === 'undefined') return;
    AppStorage.set(STATE_KEY, Object.assign({}, loadState(), patch));
  }
  function snapshot() { return ((typeof AppStorage !== 'undefined') ? AppStorage.get(SNAPSHOT_KEY) : null) || null; }

  /* local vs backend record comparison for the admin card */
  function compare() {
    const local = (typeof Migration !== 'undefined') ? Migration.counts() : {};
    const s = snapshot();
    const b = (s && s.snapshot) || {};
    const len = v => Array.isArray(v) ? v.length : (v ? 1 : 0);
    const backend = {
      profile: len(b.profile), preferences: len(b.preferences), employment: len(b.employment),
      jobs: len(b.jobs), packages: len(b.packages), submitted: len(b.submitted),
      interviews: len(b.interviews), connectors: len(b.connectors),
    };
    return { local, backend, at: s ? s.at : null };
  }

  return { SNAPSHOT_KEY, STATE_KEY, IMMUTABLE, pushAll, hydrateAll, snapshot, compare, loadState, jobsWithRaw, decisions, connectorRows };
})();
