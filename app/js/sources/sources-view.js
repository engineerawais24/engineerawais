/* ============================================================
   SourcesView + Sources — Settings UI and controller for job
   sources (Sprint 8B). Renders the source rows (enable, status,
   frequency, priority, last run), the 14 target company portals,
   and the last daily-search summary. The Sources controller
   persists every change through SourcesStore.
   ============================================================ */

const SourcesView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* effective connector state for display (7-state machine + off) */
  function stateOf(id, b) {
    if (!b.enabled) return 'off';
    const cc = ConnectorConfig.get(id);
    if (cc.simulate && cc.simulate !== 'none') return cc.simulate;
    if (!cc.useDemo && !Connectors.isConfigured(id)) return 'not_configured';
    return b.state === 'ready' && cc.useDemo ? 'ready' : (b.state || 'ready');
  }

  function stateChip(id, b) {
    const st = stateOf(id, b);
    const demo = ConnectorConfig.get(id).useDemo;
    const label = ConnectorBase.STATE_LABELS[st] + (st === 'ready' ? (demo ? ' · demo' : ' · live') : '');
    return `<span class="src-status ${st}">${label}</span>`;
  }

  /* diagnostics line: last run · jobs found · errors · rate limit */
  function diagLine(id, b) {
    if (!b.enabled) return 'disabled';
    const bits = [];
    bits.push(b.lastRun ? `Last run ${Activity.rel(b.lastRun)}` : 'No run yet');
    if (b.jobsFound != null) bits.push(`${b.jobsFound} jobs found`);
    if (b.runs) bits.push(`${b.runs} run${b.runs > 1 ? 's' : ''}`);
    if (b.rateLimitedUntil && b.rateLimitedUntil > Date.now()) {
      bits.push(`rate-limited until ${new Date(b.rateLimitedUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
    }
    /* consecutive-failure counter from the sync log (10A) */
    const retries = (typeof SyncLog !== 'undefined') ? SyncLog.retryCountOf(id) : 0;
    if (retries > 0) bits.push(`${retries} failed attempt${retries > 1 ? 's' : ''}`);
    let line = bits.join(' · ');
    if (b.lastError) line += `<br><span class="src-err">⚠ ${esc(b.lastError)}</span>`;
    return line;
  }

  /* expandable per-connector configuration (references only —
     real credentials live in the backend environment) */
  function configPanel(meta, b) {
    const cc = ConnectorConfig.get(meta.id);
    const adapter = Connectors.get(meta.id);
    const req = f => adapter.requires.includes(f) ? ' <b class="req">*</b>' : '';
    return `
      <div class="src-cfg" id="cfg-${meta.id}">
        <div class="switch-row" style="border-top:none; padding-top:0">
          <div class="sw-txt"><b>Demo data fallback</b><span>Serve sample postings until the live backend is connected</span></div>
          <label class="switch">
            <input type="checkbox" id="cfg-demo-${meta.id}" ${cc.useDemo ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        <div class="field"><label>Backend endpoint${req('endpoint')}</label>
          <input type="text" id="cfg-endpoint-${meta.id}" placeholder="https://api.yourbackend.com" value="${esc(cc.endpoint)}"></div>
        <div class="field"><label>API key reference${req('apiKeyRef')}</label>
          <input type="text" id="cfg-key-${meta.id}" placeholder="env:${meta.id.toUpperCase()}_API_KEY" value="${esc(cc.apiKeyRef)}">
          <div class="hint">Reference only (env:/secret:/vault:) — credentials never live in the browser.</div></div>
        <div class="field"><label>Session / login reference${req('sessionRef')}</label>
          <input type="text" id="cfg-session-${meta.id}" placeholder="env:${meta.id.toUpperCase()}_SESSION" value="${esc(cc.sessionRef)}"></div>
        <div class="field"><label>Simulate state (diagnostics testing)</label>
          <select id="cfg-sim-${meta.id}">
            ${ConnectorConfig.SIMULATE.map(s => `<option value="${s}" ${s === cc.simulate ? 'selected' : ''}>${s === 'none' ? 'None' : ConnectorBase.STATE_LABELS[s]}</option>`).join('')}
          </select></div>
        <div class="src-cfg-actions">
          <button class="btn btn-primary" onclick="Sources.saveConfig('${meta.id}')">Save</button>
          <button class="btn btn-ghost" onclick="Sources.test('${meta.id}')">Test connection</button>
          <button class="btn btn-ghost" onclick="Sources.retry('${meta.id}')">↻ Retry run</button>
        </div>
      </div>`;
  }

  function boardRow(meta, b, openCfg) {
    return `
      <div class="srow">
        <label class="switch">
          <input type="checkbox" ${b.enabled ? 'checked' : ''} onchange="Sources.toggleBoard('${meta.id}')">
          <span class="track"></span>
        </label>
        <div class="srow-main">
          <div class="srow-top"><b>${meta.label}</b>${stateChip(meta.id, b)}</div>
          <div class="srow-meta">${diagLine(meta.id, b)}</div>
        </div>
        <div class="srow-ctl">
          <label>Frequency
            <select onchange="Sources.setFreq('${meta.id}', this.value)" ${b.enabled ? '' : 'disabled'}>
              ${SourcesStore.FREQUENCIES.map(f => `<option ${f === b.frequency ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          <label>Priority
            <select onchange="Sources.setPriority('${meta.id}', this.value)" ${b.enabled ? '' : 'disabled'}>
              ${SourcesStore.BOARDS.map((_, i) => `<option ${i + 1 === b.priority ? 'selected' : ''}>${i + 1}</option>`).join('')}
            </select>
          </label>
          <button class="src-gear ${openCfg === meta.id ? 'active' : ''}" title="Configure connector" onclick="Sources.toggleConfig('${meta.id}')">⚙</button>
        </div>
      </div>
      ${openCfg === meta.id ? configPanel(meta, b) : ''}`;
  }

  function sourcesCard(cfg) {
    return `
      <div class="card card-pad" id="card-sources">
        <p class="card-title">Job sources</p>
        <div class="hint" style="margin-bottom:8px">Adapter-based connectors — demo fallback today, live via the backend contract. Priority decides which copy of a duplicate wins.</div>
        ${SourcesStore.BOARDS.map(meta => boardRow(meta, cfg.boards[meta.id], Sources.openConfig())).join('')}
      </div>`;
  }

  function portalsCard(cfg) {
    const on = Object.values(cfg.portals).filter(Boolean).length;
    return `
      <div class="card card-pad" id="card-portals">
        <p class="card-title">Target company portals</p>
        <div class="hint" style="margin-bottom:10px">Crawled by the Company Career Portals source — ${on} of ${SourcesStore.PORTALS.length} enabled.</div>
        <div class="portal-grid">
          ${SourcesStore.PORTALS.map(p => `
            <button class="portal-chip ${cfg.portals[p.id] ? 'active' : ''}" onclick="Sources.togglePortal('${p.id}')">
              ${cfg.portals[p.id] ? '✓ ' : ''}${p.label}
            </button>`).join('')}
        </div>
      </div>`;
  }

  function summaryStats(s) {
    const stat = (n, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
    return stat(s.found, 'jobs found')
      + stat('−' + s.duplicatesRemoved, 'duplicates removed')
      + stat('−' + s.salaryFiltered, 'salary-filtered', 'bad')
      + stat('−' + (s.regionFiltered || 0), 'outside GCC rules', 'bad')
      + stat(s.qualified, 'qualified matches', 'good')
      + stat(s.undisclosed, 'undisclosed salary')
      + stat(s.sentForReview, 'sent for review', 'good');
  }

  function summaryCard(cfg) {
    const s = cfg.lastSummary;
    return `
      <div class="card card-pad" id="card-lastsearch">
        <p class="card-title">Last daily search</p>
        ${s ? `
          <div class="ds-stats">${summaryStats(s)}</div>
          <div class="hint" style="margin-top:9px">Ran ${Activity.rel(s.ranAt)} · qualified jobs go to Today's Jobs — Approvals only after your action.</div>`
          : '<div class="hint">No run yet — the pipeline sources, normalizes, dedupes, matches and salary-filters in one pass.</div>'}
        <button class="btn btn-primary" style="margin-top:12px" onclick="runDailySearch()">Run daily search now</button>
      </div>`;
  }

  function settingsCards() {
    const cfg = SourcesStore.load();
    return sourcesCard(cfg) + portalsCard(cfg) + summaryCard(cfg);
  }

  /* compact strip for the Today's Jobs screen */
  function summaryStrip(s) {
    return `
      <div class="card ds-strip">
        <span class="eyebrow" style="font-size:9px">LAST DAILY SEARCH · ${Activity.rel(s.ranAt).toUpperCase()}</span>
        <div class="ds-stats">${summaryStats(s)}</div>
      </div>`;
  }

  return { settingsCards, summaryStrip };
})();

/* ---------- controller ---------- */

const Sources = (() => {

  let openCfgId = null;   // which connector's config panel is open

  function update(fn) {
    const state = SourcesStore.load();
    fn(state);
    SourcesStore.save(state);
    refresh();
  }

  function refresh() {
    if (typeof currentRoute === 'function' && currentRoute() === 'settings') navigate();
  }

  function openConfig() {
    return openCfgId;
  }

  function toggleConfig(id) {
    openCfgId = openCfgId === id ? null : id;
    refresh();
  }

  function saveConfig(id) {
    const val = suffix => (document.getElementById(`cfg-${suffix}-${id}`) || {});
    const res = ConnectorConfig.set(id, {
      useDemo: !!val('demo').checked,
      endpoint: val('endpoint').value || '',
      apiKeyRef: val('key').value || '',
      sessionRef: val('session').value || '',
      simulate: val('sim').value || 'none',
    });
    if (!res.ok) {
      toast(res.error, 'error');
      return false;
    }
    toast('Connector configuration saved — references only, no credentials stored');
    refresh();
    return true;
  }

  function test(id) {
    DailySearch.retryBoard(id, { probe: true });
    refresh();
  }

  function retry(id) {
    DailySearch.retryBoard(id);
    refresh();
  }

  function toggleBoard(id) {
    update(s => {
      s.boards[id].enabled = !s.boards[id].enabled;
    });
  }

  function setFreq(id, v) {
    update(s => { s.boards[id].frequency = v; });
  }

  function setPriority(id, v) {
    update(s => { s.boards[id].priority = Number(v) || 1; });
  }

  function togglePortal(id) {
    update(s => { s.portals[id] = !s.portals[id]; });
  }

  return {
    toggleBoard, setFreq, setPriority, togglePortal,
    openConfig, toggleConfig, saveConfig, test, retry,
  };
})();
