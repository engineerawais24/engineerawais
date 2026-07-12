/* ============================================================
   ConnectorIntegration — the production integration layer
   (Sprint 15 PART 1, 2, 5, 8).

   Runs every connector through the STANDARD LIFECYCLE:
     initialize → authenticate → healthCheck → searchJobs →
     normalize → validate → rateLimit → shutdown
   applying centralized rate limiting (RateLimitManager),
   auth posture (ConnectorAuth), a normalization guard (canonical
   job validation), per-connector analytics (ConnectorAnalytics)
   and cross-connector deduplication (Deduplicator).

   It is a NEW, read-only path layered ABOVE the existing
   ConnectorManager / Pipeline (which are unchanged, so the live
   daily-search UI and GCC/salary/ranking/decision stages behave
   exactly as before). This layer is what /admin diagnostics use
   and what a real backend will drive.

   SAFETY (PART 9): connectors here only READ. Nothing in this
   layer submits applications or writes profile / resume /
   application / interview data.
   ============================================================ */

const ConnectorIntegration = (() => {

  const LAST_KEY = 'integration_last';
  const HISTORY_KEY = 'connector_search_history';
  const MAX_HISTORY = 20;

  const CANONICAL_FIELDS = ['title', 'company', 'location', 'salary', 'workMode', 'employmentType', 'source', 'applyUrl', 'description', 'skills', 'postedDate'];
  const SOURCE_TO_ID = {
    'LinkedIn': 'linkedin', 'Bayt': 'bayt', 'GulfTalent': 'gulftalent', 'Greenhouse': 'greenhouse',
    'Lever': 'lever', 'Workday': 'workday', 'SmartRecruiters': 'smartrecruiters', 'Company Careers': 'careers',
  };
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const statusLabel = s => (typeof ConnectorBase !== 'undefined' && ConnectorBase.STATUS_LABELS[s]) || s;

  /* ---- PART 5: canonical-field normalization guard ---- */
  function fieldPresent(job, f) {
    if (f === 'salary') return job.salaryDisclosed === false || (job.salary != null && job.salary !== '');
    if (f === 'skills') return Array.isArray(job.skills) && job.skills.length > 0;
    return String(job[f] == null ? '' : job[f]).trim() !== '';
  }
  function normalizationCheck(job) {
    const missing = CANONICAL_FIELDS.filter(f => !fieldPresent(job, f));
    return { id: job.id, valid: missing.length === 0, missing };
  }

  function enabledIds() {
    if (typeof ConnectorManager !== 'undefined' && ConnectorManager.enabledIds) {
      try { return ConnectorManager.enabledIds(); } catch (e) { /* fall through */ }
    }
    return (typeof Connectors !== 'undefined') ? Connectors.all().map(a => a.id) : [];
  }

  function finalize(id, label, status, jobs, extra, responseMs) {
    extra = extra || {};
    return {
      id, label, status, statusLabel: statusLabel(status),
      jobs: jobs || [], jobCount: (jobs || []).length,
      responseMs: Math.round(responseMs || 0),
      auth: extra.auth || null,
      rateLimit: extra.rl || null,
      reports: extra.reports || null,
      accepted: extra.accepted != null ? extra.accepted : (jobs || []).length,
      rejected: extra.rejected || 0,
      error: extra.error || null,
      analytics: (typeof ConnectorAnalytics !== 'undefined') ? ConnectorAnalytics.summary(id) : null,
    };
  }

  /* ---- PART 1/2: one connector through the full lifecycle ---- */
  function lifecycle(id, opts) {
    opts = opts || {};
    const adapter = (typeof Connectors !== 'undefined') ? Connectors.get(id) : null;
    if (!adapter) return finalize(id, id, 'error', [], { error: 'Unknown connector' }, 0);
    const label = adapter.label;

    adapter.initialize();
    const board = (typeof SourcesStore !== 'undefined') ? (SourcesStore.load().boards[id] || null) : null;

    if (board && board.enabled === false) {
      return finalize(id, label, 'disabled', [], { note: 'Disabled in settings' }, 0);
    }

    const auth = (typeof ConnectorAuth !== 'undefined') ? ConnectorAuth.authenticate(id) : { state: 'ready' };

    /* offline / maintenance short-circuit (from healthCheck/simulate) */
    const health0 = adapter.healthCheck().health;
    if (health0 === 'offline' || health0 === 'maintenance') {
      if (typeof ConnectorAnalytics !== 'undefined') ConnectorAnalytics.record(id, { ok: false, error: health0 });
      return finalize(id, label, health0, [], { auth, error: health0 }, 0);
    }

    /* centralized rate limit gate */
    const rl = (typeof RateLimitManager !== 'undefined') ? RateLimitManager.check(id) : { allowed: true };
    if (!rl.allowed) {
      if (typeof ConnectorAnalytics !== 'undefined') ConnectorAnalytics.record(id, { ok: false, error: 'rate_limited:' + rl.reason });
      return finalize(id, label, 'rate_limited', [], { auth, rl }, 0);
    }

    const t0 = now();
    const res = adapter.searchJobs(opts.params || {});
    const responseMs = now() - t0;
    if (typeof RateLimitManager !== 'undefined') RateLimitManager.record(id);

    if (!res.ok) {
      let status = 'error';
      if (res.state === 'rate_limited') { if (typeof RateLimitManager !== 'undefined') RateLimitManager.penalize(id, res.retryAfter); status = 'rate_limited'; }
      else if (res.state === 'auth_required') status = 'auth_required';
      else if (res.state === 'offline') status = 'offline';
      else if (res.state === 'maintenance') status = 'maintenance';
      else if (res.state === 'not_configured') status = 'not_configured';
      if (typeof ConnectorAnalytics !== 'undefined') ConnectorAnalytics.record(id, { responseMs, ok: false, error: res.error });
      adapter.shutdown();
      return finalize(id, label, status, [], { auth, rl, error: res.error }, responseMs);
    }

    /* success → normalize + validate every job (canonical + schema) */
    if (typeof RateLimitManager !== 'undefined') RateLimitManager.reset(id);
    const jobs = res.jobs || [];
    const reports = jobs.map(j => {
      const nm = normalizationCheck(j);
      const schema = (typeof adapter.validate === 'function') ? adapter.validate(j) : [];
      return { id: j.id, valid: nm.valid && schema.length === 0, missing: nm.missing, schemaProblems: schema };
    });
    const accepted = jobs.filter((j, i) => reports[i].valid);
    const rejected = jobs.length - accepted.length;
    if (typeof ConnectorAnalytics !== 'undefined') {
      ConnectorAnalytics.record(id, { searched: jobs.length, normalized: jobs.length, accepted: accepted.length, rejected, responseMs, ok: true });
    }
    const rlStatus = (typeof adapter.rateLimit === 'function') ? adapter.rateLimit() : rl;
    adapter.shutdown();
    return finalize(id, label, 'healthy', accepted, { auth, rl: rlStatus, reports, accepted: accepted.length, rejected }, responseMs);
  }

  /* ---- run the whole enabled set + cross-connector dedup ---- */
  function run(opts) {
    opts = opts || {};
    const ids = opts.ids || enabledIds();
    const results = ids.map(id => lifecycle(id, opts));

    const allJobs = [];
    results.forEach(r => (r.jobs || []).forEach(j => allJobs.push(j)));
    const dedup = (typeof Deduplicator !== 'undefined') ? Deduplicator.dedupe(allJobs) : { unique: allJobs, merged: [], stats: { input: allJobs.length, unique: allJobs.length, duplicates: 0, byReason: {} } };

    /* attribute duplicates removed to the dropped copy's connector */
    if (typeof ConnectorAnalytics !== 'undefined') {
      const drops = {};
      dedup.merged.forEach(m => { const cid = SOURCE_TO_ID[m.dropped.source]; if (cid) drops[cid] = (drops[cid] || 0) + 1; });
      Object.keys(drops).forEach(cid => ConnectorAnalytics.addDuplicates(cid, drops[cid]));
    }

    const summary = {
      at: Date.now(),
      connectors: results.map(r => ({ id: r.id, label: r.label, status: r.status, jobs: r.jobCount, rejected: r.rejected, responseMs: r.responseMs })),
      totalJobs: allJobs.length, unique: dedup.stats.unique, duplicates: dedup.stats.duplicates, byReason: dedup.stats.byReason,
    };
    if (typeof AppStorage !== 'undefined') {
      AppStorage.set(LAST_KEY, summary);
      const hist = AppStorage.get(HISTORY_KEY) || [];
      hist.unshift(summary);
      if (hist.length > MAX_HISTORY) hist.length = MAX_HISTORY;
      AppStorage.set(HISTORY_KEY, hist);
    }
    return { results, jobs: dedup.unique, dedupe: dedup, summary };
  }

  function lastRun() { return (typeof AppStorage !== 'undefined') ? AppStorage.get(LAST_KEY) : null; }
  function searchHistory() { return (typeof AppStorage !== 'undefined') ? (AppStorage.get(HISTORY_KEY) || []) : []; }

  /* ---- PART 8: /admin diagnostics cards ---- */
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtTime = t => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const CHIP = { healthy: 'prep-green', disabled: 'prep-neutral', offline: 'prep-red', auth_required: 'prep-red', rate_limited: 'prep-red', maintenance: 'prep-neutral', error: 'prep-red', not_configured: 'prep-neutral' };

  function adminCards() {
    if (typeof Connectors === 'undefined') return '';
    /* lazily populate analytics once so the panels aren't empty */
    if (!lastRun()) { try { run(); } catch (e) { /* ignore */ } }
    const ids = (typeof Connectors !== 'undefined') ? Connectors.all().map(a => a.id) : [];

    const analyticsRows = ids.map(id => {
      const a = ConnectorAnalytics.summary(id);
      const h = Connectors.get(id).healthCheck();
      return `<div class="ldrow"><div><b>${esc(h.label)} <span class="prep-chip ${CHIP[h.status] || 'prep-neutral'}">${esc(h.statusLabel)}</span></b><span>${a.searched} searched · ${a.accepted} accepted · ${a.rejected} rejected · ${a.duplicatesRemoved} dupes · avg ${a.avgResponseMs}ms · ${a.successRate == null ? '—' : a.successRate + '%'} success</span></div><span class="mono">×${a.runs}</span></div>`;
    }).join('');

    const rlRows = RateLimitManager.statusAll(ids).map(r =>
      `<div class="ldrow"><div><b>${esc(r.id)}</b><span>${r.count}/${r.quota} today · backoff L${r.backoffLevel}${r.inCooldown ? ' · COOLDOWN until ' + fmtTime(r.cooldownUntil) : ''}</span></div><span class="mono">${r.remaining} left</span></div>`).join('');

    const authRows = ConnectorAuth.statusAll(ids).map(a =>
      `<div class="ldrow"><div><b>${esc(a.id)} <span class="prep-chip prep-neutral">${esc(a.strategy)}</span></b><span>${esc(a.state)} · ${esc(a.mode)}</span></div>${a.ok ? '<span class="adm-dot ok"></span>' : '<span class="adm-dot bad"></span>'}</div>`).join('');

    const totAccept = ids.reduce((n, id) => n + ConnectorAnalytics.summary(id).accepted, 0);
    const totReject = ids.reduce((n, id) => n + ConnectorAnalytics.summary(id).rejected, 0);
    const last = lastRun();
    const byReason = last && last.byReason ? Object.keys(last.byReason).map(k => `<span class="prep-chip prep-neutral">${esc(k)}: ${last.byReason[k]}</span>`).join(' ') : '';

    const history = searchHistory().slice(0, 6).map(s =>
      `<div class="ldrow"><div><b>${s.unique} unique</b><span>${s.totalJobs} retrieved · ${s.duplicates} duplicates removed · ${s.connectors.length} connectors</span></div><span class="mono">${fmtTime(s.at)}</span></div>`).join('');

    const stat = (n, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
    return `
      <div class="card card-pad">
        <p class="card-title">Connector analytics <span class="hint" style="font-weight:400">· Sprint 15 integration layer</span></p>
        ${analyticsRows || '<div class="hint">No connectors.</div>'}
      </div>
      <div class="card card-pad">
        <p class="card-title">Rate-limit status</p>
        ${rlRows || '<div class="hint">No rate-limit data.</div>'}
      </div>
      <div class="card card-pad">
        <p class="card-title">Authentication status</p>
        ${authRows || '<div class="hint">No connectors.</div>'}
      </div>
      <div class="card card-pad">
        <p class="card-title">Normalization health</p>
        <div class="ds-stats">
          ${stat(totAccept, 'accepted', 'good')}
          ${stat(totReject, 'flagged/rejected', totReject ? 'bad' : 'good')}
          ${stat(CANONICAL_FIELDS.length, 'canonical fields')}
        </div>
        <div class="hint" style="margin-top:8px">Every connector output is validated against the canonical contract: ${CANONICAL_FIELDS.join(', ')}.</div>
      </div>
      <div class="card card-pad">
        <p class="card-title">Deduplication statistics</p>
        <div class="ds-stats">
          ${stat(last ? last.totalJobs : 0, 'retrieved')}
          ${stat(last ? last.unique : 0, 'unique', 'good')}
          ${stat(last ? last.duplicates : 0, 'duplicates removed')}
        </div>
        ${byReason ? `<div class="prep-sub">MERGE REASONS</div><div class="job-chips">${byReason}</div>` : ''}
      </div>
      <div class="card card-pad">
        <p class="card-title">Integration search history</p>
        ${history || '<div class="hint">No integration runs recorded yet.</div>'}
      </div>`;
  }

  return { CANONICAL_FIELDS, normalizationCheck, enabledIds, lifecycle, run, lastRun, searchHistory, adminCards };
})();
