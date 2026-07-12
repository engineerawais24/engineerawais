/* ============================================================
   Imports — controller for the Import Job flow (Sprint 26).

   Import → Review → Approve → Create Application.

   It owns only the form's working state; everything persistent lives
   in ImportedJobs, the score comes from JobMatchEngine (Sprint 25) and
   the application is an ApplicationPackage (Sprint 23/24). Nothing is
   fetched, scraped or auto-applied.
   ============================================================ */

const Imports = (() => {

  const BLANK = {
    url: '', title: '', company: '', location: '',
    workplaceType: 'On Site', source: '', salary: '', postedDate: '', description: '',
  };

  const ui = {
    formOpen: false,
    showRejected: false,        // the default view hides rejected jobs
    form: Object.assign({}, BLANK),
    errors: {},
    open: {},                   // expanded job details
  };

  function refresh() {
    if (typeof currentRoute === 'function' && currentRoute() === 'jobs') navigate();
    else if (typeof renderNav === 'function') renderNav();
  }

  /* ---------- the list Today's Jobs renders ---------- */

  function visible() {
    return ui.showRejected ? ImportedJobs.rejected() : ImportedJobs.active();
  }

  /* score every visible job once per render, against one profile snapshot */
  function matches(jobs) {
    const out = {};
    if (typeof JobMatchEngine === 'undefined') return out;
    const snapshot = JobMatchEngine.snapshotFromProfile(
      (typeof Profile !== 'undefined') ? Profile.getState() : {}
    );
    (jobs || []).forEach(j => { out[j.id] = ImportedJobs.match(j, snapshot); });
    return out;
  }

  function render() {
    if (typeof ImportedJobs === 'undefined' || typeof ImportView === 'undefined') return '';
    const jobs = visible();
    return ImportView.section(ui, jobs, matches(jobs));
  }

  /* ---------- the form ---------- */

  function toggleForm() {
    ui.formOpen = !ui.formOpen;
    if (!ui.formOpen) {
      ui.form = Object.assign({}, BLANK);
      ui.errors = {};
    }
    refresh();
  }

  /* Typed characters are held in memory and NOT re-rendered — re-rendering on
     every keystroke would move the caret. The field's error clears as soon as
     the user starts fixing it. */
  function setField(name, value) {
    if (!(name in BLANK)) return;
    ui.form[name] = value;
    if (ui.errors[name]) {
      delete ui.errors[name];
      const el = document.querySelector(`.imp-form [oninput*="'${name}'"], .imp-form [onchange*="'${name}'"]`);
      if (el) el.classList.remove('err');
      const err = el && el.parentElement && el.parentElement.querySelector('.ferr');
      if (err) err.remove();
    }
  }

  function submit() {
    const res = ImportedJobs.create(ui.form);
    if (!res.ok) {
      ui.errors = res.errors;
      ui.formOpen = true;                 // the form must stay open, or the errors are invisible
      if (typeof toast === 'function') toast('Check the highlighted fields', 'error');
      refresh();
      return res;
    }
    ui.errors = {};
    ui.form = Object.assign({}, BLANK);
    ui.formOpen = false;
    ui.showRejected = false;
    if (typeof toast === 'function') toast(`Imported — ${res.job.title} at ${res.job.company}`);
    refresh();
    return res;
  }

  /* ---------- review ---------- */

  function setStatus(id, status) {
    const job = ImportedJobs.setStatus(id, status);
    if (!job) {
      if (typeof toast === 'function') toast('Unknown review status — nothing changed', 'error');
      refresh();
      return null;
    }
    if (typeof toast === 'function') {
      toast(job.status === 'rejected'
        ? `${job.company} rejected — kept under the Rejected filter`
        : `${job.company} → ${ImportedJobs.statusLabel(job.status)}`);
    }
    refresh();
    return job;
  }

  function toggleDetails(id) {
    ui.open[id] = !ui.open[id];
    refresh();
  }

  function toggleRejected() {
    ui.showRejected = !ui.showRejected;
    refresh();
  }

  /* ---------- approve → application ---------- */

  function createApplication(id) {
    const res = ImportedJobs.createApplication(id);
    if (typeof toast === 'function') {
      toast(res.ok
        ? `Application package created — review it on the Applications page`
        : res.error, res.ok ? 'success' : 'error');
    }
    refresh();
    return res;
  }

  return {
    ui, render, visible, matches,
    toggleForm, setField, submit,
    setStatus, toggleDetails, toggleRejected,
    createApplication,
  };
})();
