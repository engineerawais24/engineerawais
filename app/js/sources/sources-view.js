/* ============================================================
   SourcesView + Sources — Settings UI and controller for job
   sources (Sprint 8B). Renders the source rows (enable, status,
   frequency, priority, last run), the 14 target company portals,
   and the last daily-search summary. The Sources controller
   persists every change through SourcesStore.
   ============================================================ */

const SourcesView = (() => {

  function statusChip(b) {
    if (!b.enabled) return '<span class="src-status off">Off</span>';
    if (b.lastRun) return '<span class="src-status ok">OK · connected (mock)</span>';
    return '<span class="src-status ready">Ready · mock connector</span>';
  }

  function lastRunText(b) {
    if (!b.enabled) return 'disabled';
    return b.lastRun ? 'Last successful search ' + Activity.rel(b.lastRun) : 'No successful search yet';
  }

  function boardRow(meta, b) {
    return `
      <div class="srow">
        <label class="switch">
          <input type="checkbox" ${b.enabled ? 'checked' : ''} onchange="Sources.toggleBoard('${meta.id}')">
          <span class="track"></span>
        </label>
        <div class="srow-main">
          <div class="srow-top"><b>${meta.label}</b>${statusChip(b)}</div>
          <div class="srow-meta">${lastRunText(b)}</div>
        </div>
        <div class="srow-ctl">
          <label>Frequency
            <select onchange="Sources.setFreq('${meta.id}', this.value)" ${b.enabled ? '' : 'disabled'}>
              ${SourcesStore.FREQUENCIES.map(f => `<option ${f === b.frequency ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </label>
          <label>Priority
            <select onchange="Sources.setPriority('${meta.id}', this.value)" ${b.enabled ? '' : 'disabled'}>
              ${[1, 2, 3, 4].map(n => `<option ${n === b.priority ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>`;
  }

  function sourcesCard(cfg) {
    return `
      <div class="card card-pad" id="card-sources">
        <p class="card-title">Job sources</p>
        <div class="hint" style="margin-bottom:8px">Priority decides which copy of a duplicate job wins. Connectors are mocks until live integrations land.</div>
        ${SourcesStore.BOARDS.map(meta => boardRow(meta, cfg.boards[meta.id])).join('')}
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

  function update(fn) {
    const state = SourcesStore.load();
    fn(state);
    SourcesStore.save(state);
    if (typeof currentRoute === 'function' && currentRoute() === 'settings') navigate();
  }

  function toggleBoard(id) {
    update(s => {
      s.boards[id].enabled = !s.boards[id].enabled;
      s.boards[id].status = s.boards[id].enabled ? (s.boards[id].lastRun ? 'ok' : 'ready') : 'off';
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

  return { toggleBoard, setFreq, setPriority, togglePortal };
})();
