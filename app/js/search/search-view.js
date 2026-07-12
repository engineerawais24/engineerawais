/* ============================================================
   SearchView — the job-search panel (Sprint 18 PART 8).

   ADDITIVE: it renders ABOVE the existing "Today's Jobs" screen.
   Nothing in the Jobs module, the job cards, or the approval /
   decision workflow is redesigned or removed.

   On search it hands the ranked results to the EXISTING pipeline:
     SearchEngine.toDiscovered(jobs) → JobsStore.setDiscovered()
     → Jobs.reload()
   so every result still flows through MatchEngine, DecisionEngine,
   the GCC/salary rules and the normal Approve / Later / Reject
   buttons. NOTHING is ever submitted from here.
   ============================================================ */

const SearchView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ui = {
    open: false,
    running: false,
    searchId: null,
    last: null,          // last { jobs, history }
    error: null,
  };

  const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const chk = id => { const el = document.getElementById(id); return !!(el && el.checked); };
  const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

  function readFilters() {
    const providers = SearchEngine.providerIds().filter(id => chk('se-p-' + id));
    return {
      query: val('se-query'),
      titles: csv(val('se-titles')),
      locations: csv(val('se-locations')),
      countries: csv(val('se-countries')),
      remote: chk('se-remote'), hybrid: chk('se-hybrid'), onsite: chk('se-onsite'),
      salaryMin: val('se-salmin'), salaryMax: val('se-salmax'),
      experienceMin: val('se-expmin'), experienceMax: val('se-expmax'),
      employmentType: val('se-type') || null,
      keywords: csv(val('se-keywords')),
      excludedKeywords: csv(val('se-excluded')),
      providers,
    };
  }

  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function' && currentRoute() === 'jobs') navigate();
  }

  async function run(opts) {
    if (ui.running) return;
    ui.running = true; ui.error = null;
    const filters = (opts && opts.filters) || readFilters();
    refresh();
    try {
      const res = await SearchEngine.search(filters, Object.assign({}, opts && opts.options));
      ui.last = res;
      ui.searchId = res.searchId;
      /* hand results to the EXISTING approval workflow */
      if (typeof JobsStore !== 'undefined') {
        const discovered = SearchEngine.toDiscovered(res.jobs);
        JobsStore.setDiscovered(discovered);
        if (typeof Jobs !== 'undefined' && Jobs.reload) Jobs.reload();
      }
      const h = res.history || {};
      if (typeof toast === 'function') {
        toast(h.cancelled ? 'Search cancelled'
          : `${h.finalResultCount} job(s) · ${h.duplicateCount} duplicate(s) merged${h.cacheHit ? ' · from cache' : ''}${h.offline ? ' · offline' : ''}`,
          h.cancelled ? 'info' : 'success');
      }
    } catch (e) {
      ui.error = (e && e.message) || 'search failed';
      if (typeof toast === 'function') toast('Search failed — ' + ui.error, 'error');
    } finally {
      ui.running = false;
      refresh();
    }
  }

  function refreshSearch() { return run({ options: { refresh: true } }); }

  function cancel() {
    if (!ui.searchId) return;
    SearchEngine.cancel(ui.searchId);
    if (typeof toast === 'function') toast('Cancelling search…', 'info');
  }

  function rerun(id) {
    const e = SearchEngine.getHistory().find(h => h.id === id);
    if (!e) return;
    run({ filters: e.filters, options: { refresh: true } });
  }

  function toggle() { ui.open = !ui.open; refresh(); }

  /* ---------- rendering ---------- */
  function providerChips() {
    return SearchEngine.providerHealth().map(h => {
      const cls = h.reachable === false ? 'prep-red' : (h.reachable ? 'prep-green' : 'prep-neutral');
      const label = h.reachable === false ? 'failed' : (h.reachable ? h.resultCount + ' results' : 'idle');
      return `<span class="prep-chip ${cls}" title="${esc(h.lastError || '')}">${esc(h.label)}: ${esc(label)}</span>`;
    }).join(' ');
  }

  function providerBoxes() {
    return SearchEngine.allProviders().map(p =>
      `<label class="se-check"><input type="checkbox" id="se-p-${esc(p.id)}" checked> ${esc(p.label)}</label>`).join('');
  }

  function rankedRow(j) {
    const r = j.ranking || {};
    const cls = r.score >= 70 ? 'prep-green' : (r.score >= 55 ? 'prep-indigo' : (r.score >= 40 ? 'prep-neutral' : 'prep-red'));
    const top = (r.reasons || []).slice().sort((a, b) => b.points - a.points).slice(0, 3)
      .map(x => `${esc(x.component)} +${x.points}`).join(' · ');
    const warn = (r.warnings || []).map(w => `<span class="prep-chip prep-red">${esc(w.text)}</span>`).join(' ');
    return `
      <div class="se-row">
        <div class="se-row-top">
          <span class="prep-chip ${cls}">${r.score != null ? r.score : '—'} · ${esc(r.scoreBand || '')}</span>
          <b>${esc(j.title)}</b><span class="prep-co">· ${esc(j.company)}</span>
          <span class="ans-src">${esc((j.providers || []).join(' + '))}${(j.providers || []).length > 1 ? ' (merged)' : ''}</span>
        </div>
        <div class="se-meta">${esc(j.location || '')} · ${esc(r.recommendation || '')}</div>
        <div class="se-why">
          <b>Why:</b> ${esc(top || '—')}
          ${(r.strengths || []).length ? `<div class="se-good">✓ ${esc((r.strengths || []).slice(0, 2).join(' · '))}</div>` : ''}
          ${(r.gaps || []).length ? `<div class="se-bad">△ ${esc((r.gaps || []).slice(0, 2).join(' · '))}</div>` : ''}
          ${warn ? `<div style="margin-top:4px">${warn}</div>` : ''}
        </div>
      </div>`;
  }

  function panel() {
    if (typeof SearchEngine === 'undefined') return '';
    const h = (ui.last && ui.last.history) || null;
    const hist = SearchEngine.getHistory(4);
    const diag = SearchEngine.getDiagnostics();

    const indicators = h ? `
      <span class="prep-chip prep-neutral">${h.finalResultCount} result(s)</span>
      <span class="prep-chip prep-neutral">${h.duplicateCount} duplicate(s) merged</span>
      ${h.cacheHit ? '<span class="prep-chip prep-indigo">from cache</span>' : ''}
      ${h.offline ? '<span class="prep-chip prep-red">offline</span>' : ''}
      ${h.cancelled ? '<span class="prep-chip prep-red">cancelled</span>' : ''}
      <span class="prep-chip prep-neutral">${h.durationMs}ms</span>
      ${(h.providersFailed || []).length ? `<span class="prep-chip prep-red">${h.providersFailed.length} provider(s) failed</span>` : ''}` : '';

    if (!ui.open) {
      return `
        <div class="card card-pad se-card">
          <div class="se-head">
            <p class="card-title" style="margin:0">Job search <span class="hint" style="font-weight:400">· ${SearchEngine.providerIds().length} providers · ${diag.totalSearches} search(es) run</span></p>
            <div class="job-chips">${indicators}</div>
            <button class="btn btn-primary" onclick="SearchView.toggle()">Open search</button>
          </div>
        </div>`;
    }

    return `
      <div class="card card-pad se-card">
        <div class="se-head">
          <p class="card-title" style="margin:0">Job search</p>
          <div class="job-chips">${indicators}</div>
          <button class="btn btn-ghost" onclick="SearchView.toggle()">Hide</button>
        </div>

        <div class="prep-sub">PROVIDERS</div>
        <div class="se-checks">${providerBoxes()}</div>
        <div class="job-chips" style="margin-top:6px">${providerChips()}</div>

        <div class="prep-sub">FILTERS</div>
        <div class="se-grid">
          <div class="field"><label>Keywords / query</label><input type="text" id="se-query" placeholder="solutions engineer"></div>
          <div class="field"><label>Job titles (comma separated)</label><input type="text" id="se-titles" placeholder="Solutions Engineer, Architect"></div>
          <div class="field"><label>Locations</label><input type="text" id="se-locations" placeholder="Riyadh, Dubai"></div>
          <div class="field"><label>Countries</label><input type="text" id="se-countries" placeholder="Saudi Arabia, UAE"></div>
          <div class="field"><label>Salary min</label><input type="number" id="se-salmin" placeholder="0"></div>
          <div class="field"><label>Salary max</label><input type="number" id="se-salmax" placeholder=""></div>
          <div class="field"><label>Experience min (yrs)</label><input type="number" id="se-expmin" placeholder="0"></div>
          <div class="field"><label>Experience max (yrs)</label><input type="number" id="se-expmax" placeholder=""></div>
          <div class="field"><label>Employment type</label>
            <select id="se-type"><option value="">Any</option><option>Full-time</option><option>Contract</option><option>Part-time</option></select></div>
          <div class="field"><label>Must include keywords</label><input type="text" id="se-keywords" placeholder="terraform, azure"></div>
          <div class="field"><label>Excluded keywords</label><input type="text" id="se-excluded" placeholder="unpaid, commission-only"></div>
          <div class="field"><label>Work mode</label>
            <div class="se-checks">
              <label class="se-check"><input type="checkbox" id="se-remote"> Remote</label>
              <label class="se-check"><input type="checkbox" id="se-hybrid"> Hybrid</label>
              <label class="se-check"><input type="checkbox" id="se-onsite"> On-site</label>
            </div>
          </div>
        </div>

        <div class="prep-actions">
          <button class="btn btn-primary" onclick="SearchView.run()" ${ui.running ? 'disabled' : ''}>${ui.running ? 'Searching…' : 'Search'}</button>
          <button class="btn btn-ghost" onclick="SearchView.refreshSearch()" ${ui.running ? 'disabled' : ''}>Force refresh (skip cache)</button>
          <button class="btn btn-red" onclick="SearchView.cancel()" ${ui.running ? '' : 'disabled'}>Cancel</button>
          <span class="hint" style="margin:0">Results feed the normal Today's Jobs approval flow below. Nothing is ever submitted from here.</span>
        </div>

        ${ui.error ? `<div class="mi-row">⛔ ${esc(ui.error)}</div>` : ''}

        ${(ui.last && ui.last.jobs.length) ? `
          <div class="prep-sub">RANKED RESULTS (score + explanation)</div>
          ${ui.last.jobs.slice(0, 8).map(rankedRow).join('')}
          <div class="hint" style="margin-top:6px">All ${ui.last.jobs.length} result(s) are loaded into Today's Jobs below — approve, save for later or reject them there as usual.</div>` : ''}

        ${hist.length ? `
          <div class="prep-sub">RECENT SEARCHES</div>
          ${hist.map(e => `
            <div class="ldrow">
              <div><b>${esc(e.filters && e.filters.query ? e.filters.query : '(no query)')}</b>
                <span>${e.finalResultCount} result(s) · ${e.duplicateCount} dup · ${e.durationMs}ms${e.cacheHit ? ' · cache' : ''}${e.offline ? ' · offline' : ''}${e.cancelled ? ' · cancelled' : ''}</span></div>
              <button class="btn btn-ghost" onclick="SearchView.rerun('${esc(e.id)}')">Rerun</button>
            </div>`).join('')}` : ''}
      </div>`;
  }

  return { panel, toggle, run, refreshSearch, cancel, rerun, readFilters, ui };
})();
