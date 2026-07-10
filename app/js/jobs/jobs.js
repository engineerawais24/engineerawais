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
  const ui = { source: 'All', showHidden: false };

  /* ---------- evaluation ---------- */

  function snapshot() {
    return MatchEngine.snapshotFromProfile(Profile.getState(), MasterResume.get());
  }

  function evaluated() {
    const snap = snapshot();
    const list = state.discovered || JobsStore.jobs();
    return list.map(job => ({
      job,
      res: MatchEngine.evaluate(job, snap),
      status: state.decisions[job.id] || 'pending',
    }));
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
      if (panel.hidden) {
        const item = evaluated().find(x => x.job.id === id);
        btn.textContent = `Why ${item ? item.res.score : ''}?`;
      } else {
        btn.textContent = 'Hide breakdown';
      }
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
  };
})();
