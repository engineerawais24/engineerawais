/* ============================================================
   AdminView — hidden diagnostics screen (Sprint 14 PART 7).

   Reached only at #/admin (never added to the sidebar). Read-only
   window on the platform layer: storage provider + health, session
   mode, sync status + queues, job cache, connector health,
   API-client status, telemetry and recent centralized errors.
   Design stays consistent with the rest of the app (cards, stats,
   chips). It reads live state; it changes nothing.
   ============================================================ */

const AdminView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const stat = (n, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
  const dot = ok => `<span class="adm-dot ${ok ? 'ok' : 'bad'}"></span>`;
  const fmtTime = t => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const kb = b => b == null ? '—' : (b / 1024).toFixed(1) + ' KB';

  function backendCard() {
    if (typeof Backend === 'undefined') return '';
    const s = Backend.status();
    const sync = s.sync || {};
    const hyd = s.hydration;
    const cmp = s.compare || { local: {}, backend: {} };
    const last = (typeof Migration !== 'undefined') ? Migration.lastMigration() : null;
    const apiErrs = (typeof ErrorCenter !== 'undefined') ? (ErrorCenter.counts().api || 0) : 0;
    const reach = s.reachable === true ? 'reachable' : s.reachable === false ? 'offline' : 'not tested';
    const b = s.busy || {};
    const dis = k => (b[k] || Backend.isBusy('mode')) ? 'disabled' : '';
    const lbl = (k, t) => b[k] ? '…' : t;

    /* local vs backend record comparison */
    const entities = Array.from(new Set(Object.keys(cmp.local || {}).concat(Object.keys(cmp.backend || {}))));
    const cmpRows = entities.map(k => {
      const l = (cmp.local || {})[k] || 0, r = (cmp.backend || {})[k] || 0;
      const cls = l === r ? 'prep-neutral' : 'prep-red';
      return `<span class="prep-chip ${cls}">${esc(k)}: ${l}/${r}</span>`;
    }).join(' ');

    return `
      <div class="card card-pad">
        <p class="card-title">Backend &amp; persistence ${dot(s.reachable === true)}</p>
        <div class="ds-stats">
          ${stat(esc(s.mode), 'storage mode', s.mode === 'backend' ? 'good' : '')}
          ${stat(reach, 'backend', s.reachable === true ? 'good' : (s.reachable === false ? 'bad' : ''))}
          ${stat(s.apiVersion ? ('v' + s.apiVersion) : '—', 'api version')}
          ${stat(s.database || '—', 'database', s.database === 'connected' ? 'good' : '')}
        </div>
        <div class="ds-stats" style="margin-top:8px">
          ${stat(sync.pending || 0, 'pending ops', (sync.pending || 0) ? '' : 'good')}
          ${stat(sync.permanentFailed || 0, 'permanent failed', (sync.permanentFailed || 0) ? 'bad' : 'good')}
          ${stat(s.conflicts || 0, 'conflicts', (s.conflicts || 0) ? 'bad' : 'good')}
          ${stat(hyd && hyd.at ? fmtTime(hyd.at) : 'never', 'last hydration', hyd && hyd.ok ? 'good' : '')}
        </div>
        <div class="hint" style="margin-top:8px">
          Base URL <span class="mono">${esc(s.baseUrl)}</span> ·
          last successful sync ${sync.lastSuccessAt ? fmtTime(sync.lastSuccessAt) : 'never'} ·
          last failed sync ${sync.lastFailureAt ? fmtTime(sync.lastFailureAt) : 'never'} ·
          REST failures ${apiErrs}${sync.flushing ? ' · <b>flushing…</b>' : ''}
        </div>

        <div class="prep-sub">LOCAL / BACKEND RECORDS</div>
        <div class="job-chips">${cmpRows || '<span class="hint">No comparison yet — hydrate to populate.</span>'}</div>

        ${(typeof ConflictCenter !== 'undefined' && ConflictCenter.count()) ? `
          <div class="prep-sub" style="color:var(--red)">RECENT CONFLICTS (local version always kept)</div>
          ${ConflictCenter.recent(4).map(c => `<div class="mi-row">⚠ <b>${esc(c.entity)}${c.key ? '·' + esc(c.key) : ''}</b> [${esc(c.kind)}] — ${esc(c.message)}</div>`).join('')}` : ''}

        ${last ? `<div class="hint" style="margin-top:8px">Last migration ${fmtTime(last.at)}${last.result ? ` — ${last.result.success_count} imported, ${last.result.skipped_count} skipped` : ''}</div>` : ''}

        <div class="prep-actions">
          <button class="btn btn-primary" onclick="Backend.adminTest()" ${dis('test')}>${lbl('test', 'Test Connection')}</button>
          <button class="btn btn-ghost" onclick="Backend.adminHydrate()" ${dis('hydrate')}>${lbl('hydrate', 'Hydrate From Backend')}</button>
          <button class="btn btn-green" onclick="Backend.adminSyncNow()" ${dis('sync')}>${lbl('sync', 'Sync Now')}</button>
          <button class="btn btn-amber" onclick="Backend.adminRetryFailed()" ${dis('retry')}>${lbl('retry', 'Retry Failed Operations')}</button>
        </div>
        <div class="prep-actions" style="border-top:none; padding-top:0">
          ${s.mode === 'backend'
            ? `<button class="btn btn-ghost" onclick="Backend.adminUseLocal()" ${dis('mode')}>${lbl('mode', 'Switch to Local Mode')}</button>`
            : `<button class="btn btn-primary" onclick="Backend.adminUseBackend()" ${dis('mode')}>${lbl('mode', 'Switch to Backend Mode')}</button>`}
          <button class="btn btn-ghost" onclick="Migration.adminMigrate()">Migrate local data</button>
          <span class="hint" style="margin:0">Switching modes never deletes local or backend data. Local mode always works offline.</span>
        </div>
      </div>`;
  }

  function storageCard() {
    if (typeof AppStorage === 'undefined') return '';
    const h = AppStorage.healthCheck();
    const kinds = (typeof StorageProviders !== 'undefined') ? StorageProviders.kinds : [];
    return `
      <div class="card card-pad">
        <p class="card-title">Storage provider ${dot(h.ok)}</p>
        <div class="ds-stats">
          ${stat(esc(AppStorage.name()), 'active provider')}
          ${stat(h.writable ? 'yes' : 'no', 'writable', h.writable ? 'good' : 'bad')}
          ${stat(h.keys != null ? h.keys : '—', 'namespaced keys')}
          ${stat(kb(h.bytes), 'used')}
        </div>
        <div class="hint" style="margin-top:8px">Namespace <span class="mono">${esc(h.namespace || '')}</span> — existing app data is outside this namespace and untouched. Prepared providers: ${kinds.map(k => `<span class="prep-chip prep-neutral">${esc(k)}</span>`).join(' ')}</div>
      </div>`;
  }

  function sessionCard() {
    if (typeof SessionManager === 'undefined') return '';
    const s = SessionManager.current();
    return `
      <div class="card card-pad">
        <p class="card-title">Session</p>
        <div class="ds-stats">
          ${stat(esc(s.mode), 'mode')}
          ${stat(s.mode === 'authenticated' ? 'yes' : 'no', 'authenticated')}
          ${stat(s.expiresAt ? fmtTime(s.expiresAt) : 'never', 'expires')}
        </div>
        <div class="hint" style="margin-top:8px">Device <span class="mono">${esc(s.deviceId)}</span> · anon <span class="mono">${esc(s.anonymousId)}</span> · tokens are placeholders (no login yet).</div>
      </div>`;
  }

  function syncCard() {
    if (typeof SyncManager === 'undefined') return '';
    const st = SyncManager.status();
    const pend = SyncManager.pending().slice(0, 8).map(o => `
      <div class="ldrow"><div><b>${esc(o.type)} ${esc(o.entity || o.key || '')}</b><span>${esc(o.status)} · attempts ${o.attempts}${o.conflict ? ' · CONFLICT' : ''}${o.lastError ? ' · ' + esc(o.lastError) : ''}</span></div><span class="mono">${fmtTime(o.updatedAt)}</span></div>`).join('');
    const hist = SyncManager.history().slice(0, 5).map(o => `
      <div class="ldrow"><div><b>${esc(o.type)} ${esc(o.entity || o.key || '')}</b><span>${esc(o.status)}${o.lastError ? ' · ' + esc(o.lastError) : ''}</span></div><span class="mono">${fmtTime(o.updatedAt)}</span></div>`).join('');
    return `
      <div class="card card-pad">
        <p class="card-title">Sync manager ${dot(st.online)}</p>
        <div class="ds-stats">
          ${stat(st.online ? 'online' : 'offline', 'mode', st.online ? 'good' : '')}
          ${stat(st.pending, 'queued', st.pending ? '' : 'good')}
          ${stat(st.failed, 'failed', st.failed ? 'bad' : 'good')}
          ${stat(st.lastSync ? fmtTime(st.lastSync) : 'never', 'last sync')}
        </div>
        ${pend ? `<div class="prep-sub">QUEUED OPERATIONS</div>${pend}` : '<div class="hint" style="margin-top:8px">No queued operations.</div>'}
        ${hist ? `<div class="prep-sub">FAILED / COMPLETED HISTORY</div>${hist}` : ''}
      </div>`;
  }

  function cacheCard() {
    if (typeof JobCache === 'undefined') return '';
    const s = JobCache.stats();
    return `
      <div class="card card-pad">
        <p class="card-title">Job cache</p>
        <div class="ds-stats">
          ${stat(s.entries, 'cached keys')}
          ${stat(s.jobs, 'cached jobs')}
          ${stat(s.stale, 'stale', s.stale ? '' : 'good')}
          ${stat(JobCache.pendingRefreshKeys().length, 'bg-refresh queued')}
        </div>
      </div>`;
  }

  function connectorCard() {
    if (typeof ConnectorManager === 'undefined') return '';
    let health = [];
    try { health = ConnectorManager.health(); } catch (e) { health = []; }
    const rows = health.map(h => `
      <div class="ldrow"><div><b>${esc(h.label)}</b><span>${esc(h.health)}${h.jobsFound != null ? ' · ' + h.jobsFound + ' jobs' : ''}${h.retryCount ? ' · retries ' + h.retryCount : ''}</span></div>${dot(h.health === 'healthy' || h.health === 'disabled')}</div>`).join('');
    return `
      <div class="card card-pad">
        <p class="card-title">Connector health</p>
        ${rows || '<div class="hint">No connectors registered.</div>'}
      </div>`;
  }

  function apiCard() {
    if (typeof APIClient === 'undefined') return '';
    const st = APIClient.status();
    return `
      <div class="card card-pad">
        <p class="card-title">API client</p>
        <div class="ds-stats">
          ${stat(st.authenticated ? 'auth' : 'anon', 'auth')}
          ${stat(st.timeout + 'ms', 'timeout')}
          ${stat(st.retries, 'retries')}
          ${stat(st.last ? (st.last.ok ? 'ok ' + st.last.status : 'err ' + st.last.status) : 'idle', 'last call', st.last && !st.last.ok ? 'bad' : '')}
        </div>
        <div class="hint" style="margin-top:8px">Base URL <span class="mono">${esc(st.baseUrl)}</span></div>
      </div>`;
  }

  function telemetryCard() {
    if (typeof Telemetry === 'undefined') return '';
    const t = Telemetry.snapshot();
    const timings = Object.keys(t.timings).map(k => `
      <div class="ldrow"><div><b>${esc(k)}</b><span>avg ${t.timings[k].avgMs}ms · last ${t.timings[k].lastMs}ms · max ${t.timings[k].maxMs}ms</span></div><span class="mono">×${t.timings[k].count}</span></div>`).join('');
    const counters = Object.keys(t.counters).map(k => `<span class="prep-chip prep-neutral">${esc(k)}: ${t.counters[k]}</span>`).join(' ');
    return `
      <div class="card card-pad">
        <p class="card-title">Performance telemetry</p>
        ${timings || '<div class="hint">No timings recorded yet.</div>'}
        ${counters ? `<div class="prep-sub">COUNTERS</div><div class="job-chips">${counters}</div>` : ''}
      </div>`;
  }

  function errorsCard() {
    if (typeof ErrorCenter === 'undefined') return '';
    const c = ErrorCenter.counts();
    const rows = ErrorCenter.recent(10).map(e => `
      <div class="ldrow">
        <div><b>${esc(e.category)} · ${esc(e.severity)}${e.resolved ? ' · resolved' : ''}</b><span>${esc(e.message)}${e.source ? ' · ' + esc(e.source) : ''}</span></div>
        <span class="mono">${fmtTime(e.timestamp)}</span>
      </div>`).join('');
    return `
      <div class="card card-pad">
        <p class="card-title">Centralized errors</p>
        <div class="ds-stats">
          ${stat(c.total, 'total')}
          ${stat(c.unresolved, 'unresolved', c.unresolved ? 'bad' : 'good')}
          ${stat(c.connector + c.submission, 'conn/submit')}
          ${stat(c.sync + c.storage + c.api + c.validation, 'sync/storage/api')}
        </div>
        ${rows ? `<div class="prep-sub">RECENT</div>${rows}` : '<div class="hint" style="margin-top:8px">No errors recorded — clean run.</div>'}
      </div>`;
  }

  /* ---- Sprint 18: search engine diagnostics ---- */
  const searchBusy = { health: false, diag: false, clear: false };

  function searchCard() {
    if (typeof SearchEngine === 'undefined') return '';
    const d = SearchEngine.getDiagnostics();
    const cache = (typeof SearchCache !== 'undefined') ? SearchCache.stats() : {};
    const ph = d.providerHealth || [];
    const rows = ph.map(h => {
      const ok = h.reachable === true;
      const bad = h.reachable === false;
      return `<div class="ldrow"><div><b>${esc(h.label)}</b><span>${h.configured ? 'configured' : 'demo mode'} · ${h.connected ? 'connected' : 'disconnected'} · ${h.resultCount} result(s)${h.lastError ? ' · ' + esc(h.lastError) : ''}</span></div>${ok ? '<span class="adm-dot ok"></span>' : (bad ? '<span class="adm-dot bad"></span>' : '<span class="mono">idle</span>')}</div>`;
    }).join('');

    return `
      <div class="card card-pad">
        <p class="card-title">Search engine</p>
        <div class="ds-stats">
          ${stat(d.totalSearches, 'total searches')}
          ${stat(d.searchesToday, 'today')}
          ${stat(d.averageDurationMs + 'ms', 'avg duration')}
          ${stat(d.averageResultCount, 'avg results')}
        </div>
        <div class="ds-stats" style="margin-top:8px">
          ${stat(d.cacheHitRate + '%', 'cache hit rate', d.cacheHitRate >= 50 ? 'good' : '')}
          ${stat(d.staleCacheHits, 'stale hits')}
          ${stat(d.duplicateCount, 'duplicates merged')}
          ${stat(d.averageRankingScore, 'avg score', d.averageRankingScore >= 60 ? 'good' : '')}
        </div>
        <div class="ds-stats" style="margin-top:8px">
          ${stat(d.providerFailureCount, 'provider failures', d.providerFailureCount ? 'bad' : 'good')}
          ${stat(d.cancelledSearchCount, 'cancelled')}
          ${stat(d.offlineSearchCount, 'offline searches')}
          ${stat(d.activeSearchCount, 'active', d.activeSearchCount ? '' : 'good')}
        </div>
        <div class="hint" style="margin-top:8px">
          Last successful search ${d.lastSuccessfulSearch ? fmtTime(d.lastSuccessfulSearch) : 'never'} ·
          last failed ${d.lastFailedSearch ? fmtTime(d.lastFailedSearch) : 'never'} ·
          cache ${cache.entries || 0}/${cache.maxEntries || 0} entries ·
          active search ${d.activeSearch ? esc(d.activeSearch.id) : 'none'}
        </div>

        <div class="prep-sub">PROVIDER HEALTH</div>
        ${rows || '<div class="hint">No providers registered.</div>'}

        <div class="prep-actions">
          <button class="btn btn-ghost" onclick="AdminView.searchClearExpired()">Clear expired cache</button>
          <button class="btn btn-ghost" onclick="AdminView.searchRefreshHealth()">Refresh provider health</button>
          <button class="btn btn-primary" onclick="AdminView.searchDiagnosticsRun()">Run diagnostics search</button>
          <button class="btn btn-red" onclick="AdminView.searchCancelActive()" ${d.activeSearchCount ? '' : 'disabled'}>Cancel active search</button>
          <button class="btn btn-ghost" onclick="AdminView.searchExport()">Export search diagnostics</button>
        </div>
        <div class="hint">Clearing expired cache only removes stale <b>search result</b> entries — it never touches jobs, decisions, applications, interviews, résumés, profile or preferences.</div>
      </div>`;
  }

  function reRender() { if (typeof navigate === 'function' && typeof currentRoute === 'function' && currentRoute() === 'admin') navigate(); }
  function say(m, t) { if (typeof toast === 'function') toast(m, t); }

  function searchClearExpired() {
    const n = SearchCache.clearExpired();
    say(`Removed ${n} expired search-cache entr${n === 1 ? 'y' : 'ies'} — no job, decision or application data touched`, 'success');
    reRender();
  }
  function searchRefreshHealth() {
    SearchEngine.refreshProviderHealth();
    say('Provider health refreshed', 'success');
    reRender();
  }
  async function searchDiagnosticsRun() {
    if (searchBusy.diag) return;
    searchBusy.diag = true;
    try {
      /* diagnostics search uses the MOCK transport (no network) */
      const r = await SearchEngine.search({ query: '' }, { refresh: true, noBackgroundRefresh: true });
      say(`Diagnostics search: ${r.history.finalResultCount} result(s), ${r.history.duplicateCount} duplicate(s), ${r.history.durationMs}ms`, 'success');
    } catch (e) {
      say('Diagnostics search failed — ' + ((e && e.message) || 'error'), 'error');
    } finally { searchBusy.diag = false; reRender(); }
  }
  function searchCancelActive() {
    const a = SearchEngine.activeSearches();
    if (!a.length) { say('No active search', 'info'); return; }
    SearchEngine.cancelAll();
    say('Cancelled ' + a.length + ' active search(es)', 'info');
    reRender();
  }
  function searchExport() {
    try {
      const blob = new Blob([SearchEngine.exportDiagnostics()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'careerpilot-search-diagnostics.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say('Search diagnostics exported', 'success');
    } catch (e) { say('Export failed', 'error'); }
  }

  function render() {
    return `
      <p class="screen-intro">Hidden diagnostics (<span class="mono">#/admin</span>) — a read-only view of the Sprint 14 backend-readiness layer. Not linked from the sidebar; nothing here changes your data.</p>
      <div class="adm-grid">
        ${backendCard()}
        ${storageCard()}
        ${sessionCard()}
        ${syncCard()}
        ${cacheCard()}
        ${apiCard()}
        ${connectorCard()}
        ${telemetryCard()}
        ${errorsCard()}
      </div>
      ${typeof SearchEngine !== 'undefined' ? `<div class="prep-sub" style="margin:16px 0 4px">SEARCH ENGINE · SPRINT 18</div><div class="adm-grid">${searchCard()}</div>` : ''}
      ${typeof ConnectorIntegration !== 'undefined' ? `<div class="prep-sub" style="margin:16px 0 4px">CONNECTOR INTEGRATION LAYER · SPRINT 15</div><div class="adm-grid">${ConnectorIntegration.adminCards()}</div>` : ''}`;
  }

  return {
    render,
    /* Sprint 18 search diagnostics actions */
    searchClearExpired, searchRefreshHealth, searchDiagnosticsRun, searchCancelActive, searchExport,
  };
})();
