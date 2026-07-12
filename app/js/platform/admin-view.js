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

  function render() {
    return `
      <p class="screen-intro">Hidden diagnostics (<span class="mono">#/admin</span>) — a read-only view of the Sprint 14 backend-readiness layer. Not linked from the sidebar; nothing here changes your data.</p>
      <div class="adm-grid">
        ${storageCard()}
        ${sessionCard()}
        ${syncCard()}
        ${cacheCard()}
        ${apiCard()}
        ${connectorCard()}
        ${telemetryCard()}
        ${errorsCard()}
      </div>
      ${typeof ConnectorIntegration !== 'undefined' ? `<div class="prep-sub" style="margin:16px 0 4px">CONNECTOR INTEGRATION LAYER · SPRINT 15</div><div class="adm-grid">${ConnectorIntegration.adminCards()}</div>` : ''}`;
  }

  return { render };
})();
