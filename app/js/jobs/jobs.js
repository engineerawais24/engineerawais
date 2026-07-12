/* ============================================================
   Jobs — controller for Today's Jobs (Sprint 8A).
   Evaluates every sourced job through MatchEngine against a
   read-only snapshot of the Profile + master resume, owns the
   approve / later / reject decisions, and preserves the
   human-in-the-loop flow: approving creates a tailored COPY
   in the Approvals queue — the master resume is never touched
   and nothing is submitted without explicit sign-off.
   ============================================================ */

const Jobs = (() => {

  let state = JobsStore.load();          // { decisions: {jobId: status} }
  const ui = {
    source: 'All', showHidden: false,
    /* Sprint 19: board search / filters / sorting (display only) */
    filters: (typeof JobFilters !== 'undefined') ? Object.assign({}, JobFilters.DEFAULTS) : {},
    sort: 'match',
  };

  /* ---------- evaluation ---------- */

  function snapshot() {
    return MatchEngine.snapshotFromProfile(Profile.getState(), MasterResume.get());
  }

  function evaluated() {
    const snap = snapshot();
    const list = state.discovered || JobsStore.jobs();
    const companiesCfg = (typeof CompaniesStore !== 'undefined') ? CompaniesStore.load() : null;
    return list.map(job => {
      const res = MatchEngine.evaluate(job, snap);
      const rank = (companiesCfg && typeof RankEngine !== 'undefined') ? RankEngine.rank(job, res, companiesCfg) : null;
      return {
        job,
        res,
        rank,
        decision: (typeof DecisionEngine !== 'undefined') ? DecisionEngine.decide(job, res, rank, snap) : null,
        status: state.decisions[job.id] || 'pending',
      };
    });
  }

  /* re-read persisted state after a daily-search run publishes */
  function reload() {
    state = JobsStore.load();
  }

  function statusOf(id) {
    return state.decisions[id] || 'pending';
  }

  function pendingCount() {
    return evaluated().filter(x => !x.res.filtered && x.status === 'pending').length;
  }

  /* ---------- rendering ---------- */

  function render() {
    const summary = (typeof SourcesStore !== 'undefined') ? SourcesStore.load().lastSummary : null;
    return JobsView.render({
      items: evaluated(),
      ui,
      minSalary: Profile.getState().preferences.minSalary,
      summaryHtml: (summary && typeof SourcesView !== 'undefined') ? SourcesView.summaryStrip(summary) : '',
    });
  }

  function refresh() {
    if (currentRoute() === 'jobs') navigate();
    else if (typeof renderNav === 'function') renderNav();
  }

  /* ---------- Sprint 19: search, filters, sorting, saved searches ----------
     These only change what the board DISPLAYS. Decisions, the match/GCC/
     salary rules and the approval workflow are untouched. */

  function setSearch(v) {
    ui.filters.search = String(v == null ? '' : v);
    /* re-render immediately, then put the caret back where it was */
    const el = document.getElementById('job-search');
    const pos = el ? el.selectionStart : null;
    refresh();
    const back = document.getElementById('job-search');
    if (back) {
      back.focus();
      if (pos != null) { try { back.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    }
  }

  function setFilter(key, value) {
    if (typeof JobFilters === 'undefined' || !(key in JobFilters.DEFAULTS)) return;
    ui.filters[key] = value;
    refresh();
  }

  function toggleFilter(key) {
    if (typeof JobFilters === 'undefined' || !(key in JobFilters.DEFAULTS)) return;
    ui.filters[key] = !ui.filters[key];
    refresh();
  }

  function setSort(s) {
    ui.sort = s || 'match';
    refresh();
  }

  function clearFilters() {
    ui.filters = (typeof JobFilters !== 'undefined') ? Object.assign({}, JobFilters.DEFAULTS) : {};
    ui.sort = 'match';
    refresh();
  }

  function saveSearch() {
    if (typeof SavedSearches === 'undefined') return;
    const el = document.getElementById('job-save-name');
    const r = SavedSearches.save(el ? el.value : '', ui.filters, ui.sort);
    if (typeof toast === 'function') toast(r.ok ? `Saved “${r.entry.name}”` : r.error, r.ok ? 'success' : 'error');
    refresh();
  }

  function loadSearch(id) {
    if (typeof SavedSearches === 'undefined') return;
    const s = SavedSearches.get(id);
    if (!s) return;
    ui.filters = (typeof JobFilters !== 'undefined') ? JobFilters.normalize(s.filters) : Object.assign({}, s.filters);
    ui.sort = s.sort || 'match';
    if (typeof toast === 'function') toast(`Loaded “${s.name}”`);
    refresh();
  }

  function renameSearch(id) {
    if (typeof SavedSearches === 'undefined') return;
    const s = SavedSearches.get(id);
    if (!s) return;
    const name = (typeof prompt === 'function') ? prompt('Rename saved search', s.name) : null;
    if (name == null) return;
    const r = SavedSearches.rename(id, name);
    if (typeof toast === 'function') toast(r.ok ? 'Saved search renamed' : r.error, r.ok ? 'success' : 'error');
    refresh();
  }

  function deleteSearch(id) {
    if (typeof SavedSearches === 'undefined') return;
    const s = SavedSearches.get(id);
    if (!s) return;
    if (typeof confirm === 'function' && !confirm(`Delete the saved search “${s.name}”?`)) return;
    SavedSearches.remove(id);
    if (typeof toast === 'function') toast('Saved search deleted');
    refresh();
  }

  function setSource(s) {
    ui.source = s;
    refresh();
  }

  function toggleHidden() {
    ui.showHidden = !ui.showHidden;
    refresh();
  }

  /* expand/collapse the factor breakdown without a re-render
     (a re-render would scroll the list back to the top) */
  function toggleWhy(id) {
    const panel = document.getElementById('why-' + id);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    const btn = document.getElementById('whyb-' + id);
    if (btn) {
      btn.textContent = panel.hidden ? 'Why ranked here?' : 'Hide breakdown';
    }
  }

  /* ---------- decisions (persisted) ---------- */

  function decide(id, status) {
    state.decisions[id] = status;
    JobsStore.save(state);
  }

  function approve(id) {
    const item = evaluated().find(x => x.job.id === id);
    if (!item) return;
    decide(id, 'approved');
    /* Sprint 10C: build the full application package (tailored copy
       of the locked master, cover letter, provenance-backed answers,
       safety report) — reviewable in Approvals, never auto-sent */
    if (typeof Prep !== 'undefined') Prep.buildFor(item);
    /* tailored COPY into the approvals queue — master stays locked,
       and the application still needs explicit user approval there.
       resumeVersion records the EXACT document version this
       application will use (requirement: never lose provenance). */
    const master = MasterResume.get();
    DB.approvals.push({
      id: 'a-' + id,
      fromJob: id,
      company: item.job.company,
      title: item.job.title,
      resume: item.job.company + ' v1',
      resumeVersion: {
        id: 'var-' + id + '-' + Date.now(),
        label: item.job.company + ' v1',
        from: master ? `${master.name} (locked master — copied, never modified)` : 'profile-generated master',
        generatedAt: Date.now(),
      },
      ats: 82 + (item.res.score % 12),
      cover: `Draft generated from a copy of your master resume, tuned to the ${item.job.title} posting at ${item.job.company}. Review wording before it goes out…`,
      changes: [`+${item.res.matched.length + 6} keywords matched`, 'Impact bullets reordered'],
      when: 'Tailored just now',
      status: 'awaiting',
    });
    toast(`Approved — ${item.job.company} package added to Approvals (match ${item.res.score})`);
    refresh();
  }

  function reject(id) {
    decide(id, 'rejected');
    toast('Rejected — the matcher learns from this once the backend lands', 'info');
    refresh();
  }

  function later(id) {
    decide(id, 'later');
    toast('Saved for later', 'info');
    refresh();
  }

  function undo(id) {
    if (state.decisions[id] === 'approved') {
      DB.approvals = DB.approvals.filter(a => a.fromJob !== id);
    }
    delete state.decisions[id];
    JobsStore.save(state);
    toast('Decision undone', 'info');
    refresh();
  }

  return {
    render, evaluated, statusOf, pendingCount, reload,
    setSource, toggleHidden, toggleWhy,
    approve, reject, later, undo,
    /* Sprint 19 */
    ui, setSearch, setFilter, toggleFilter, setSort, clearFilters,
    saveSearch, loadSearch, renameSearch, deleteSearch,
  };
})();
