/* ============================================================
   CompaniesView + Companies — Settings UI and controller for
   company preference tiers (Sprint 8C). Move companies between
   tiers, add custom companies, remove them, and toggle boosting.
   ============================================================ */

const CompaniesView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function chip(name, tier) {
    const other = tier === 1 ? 2 : 1;
    return `
      <span class="comp-chip t${tier}">
        ${esc(name)}
        <button title="Move to Tier ${other}" onclick="Companies.move('${esc(name)}', ${other})">${tier === 1 ? '↓' : '↑'}</button>
        <button title="Remove (drops to Tier 3)" onclick="Companies.remove('${esc(name)}')">×</button>
      </span>`;
  }

  function settingsCard() {
    const cfg = CompaniesStore.load();
    return `
      <div class="card card-pad" id="card-companies">
        <p class="card-title">Company priority</p>
        <div class="switch-row" style="border-top:none; padding-top:2px">
          <div class="sw-txt"><b>Company &amp; role boosting</b><span>Ranks priority companies and target roles higher — never hides a job</span></div>
          <label class="switch">
            <input type="checkbox" ${cfg.boosting ? 'checked' : ''} onchange="Companies.toggleBoosting()">
            <span class="track"></span>
          </label>
        </div>
        <div class="tier-label">TIER 1 · HIGHEST (+12)</div>
        <div class="tier-grid">${cfg.tier1.map(n => chip(n, 1)).join('') || '<span class="hint">No companies — add one below.</span>'}</div>
        <div class="tier-label">TIER 2 · HIGH (+6)</div>
        <div class="tier-grid">${cfg.tier2.map(n => chip(n, 2)).join('') || '<span class="hint">No companies — add one below.</span>'}</div>
        <div class="hint" style="margin-top:8px">Every other company ranks as Tier 3 · standard.</div>
        <div class="comp-add">
          <input id="comp-add" type="text" placeholder="Add a company…"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();Companies.addFromForm();}">
          <select id="comp-tier"><option value="1">Tier 1</option><option value="2" selected>Tier 2</option></select>
          <button class="btn btn-ghost" onclick="Companies.addFromForm()">+ Add</button>
        </div>
      </div>`;
  }

  return { settingsCard };
})();

/* ---------- controller ---------- */

const Companies = (() => {

  function update(fn) {
    const state = CompaniesStore.load();
    fn(state);
    CompaniesStore.save(state);
    if (typeof currentRoute === 'function' && currentRoute() === 'settings') navigate();
  }

  function strip(state, name) {
    state.tier1 = state.tier1.filter(c => c.toLowerCase() !== name.toLowerCase());
    state.tier2 = state.tier2.filter(c => c.toLowerCase() !== name.toLowerCase());
  }

  function move(name, toTier) {
    update(s => {
      strip(s, name);
      (toTier === 1 ? s.tier1 : s.tier2).push(name);
    });
    toast(`${name} moved to Tier ${toTier}`, 'info');
  }

  function add(name, tier) {
    name = String(name || '').trim();
    if (!name) { toast('Enter a company name first', 'warn'); return false; }
    const state = CompaniesStore.load();
    if ([...state.tier1, ...state.tier2].some(c => c.toLowerCase() === name.toLowerCase())) {
      toast(`${name} is already tiered`, 'info');
      return false;
    }
    update(s => { (tier === 1 ? s.tier1 : s.tier2).push(name); });
    toast(`${name} added to Tier ${tier}`);
    return true;
  }

  function addFromForm() {
    const input = document.getElementById('comp-add');
    const tier = Number((document.getElementById('comp-tier') || {}).value) || 2;
    if (add(input ? input.value : '', tier)) {
      const next = document.getElementById('comp-add');
      if (next) next.focus();
    }
  }

  function remove(name) {
    update(s => strip(s, name));
    toast(`${name} removed — ranks as Tier 3 now`, 'info');
  }

  function toggleBoosting() {
    update(s => { s.boosting = !s.boosting; });
    toast(CompaniesStore.load().boosting ? 'Company & role boosting on' : 'Company & role boosting off', 'info');
  }

  return { move, add, addFromForm, remove, toggleBoosting };
})();
