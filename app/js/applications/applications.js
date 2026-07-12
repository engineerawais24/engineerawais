/* ============================================================
   Applications — controller for the Job Tracker board.
   Owns the card list and the drag-and-drop flow (vanilla
   HTML5 DnD, no libraries). Rendering is delegated to
   ApplicationsView, persistence to ApplicationsStore.
   ============================================================ */

const Applications = (() => {

  let items = ApplicationsStore.load();   // in-memory working copy
  let dragId = null;                      // card being dragged
  const ui = { open: {} };                // Sprint 23: expanded packages

  /* ---------- rendering ---------- */

  function render() {
    let pkgs = [];
    if (typeof ApplicationPackages !== 'undefined') {
      /* the résumé can also be changed from the job card, so make sure the
         package shows the one currently selected before it is displayed */
      ApplicationPackages.all().forEach(p => ApplicationPackages.syncToResume(p.id));
      pkgs = ApplicationPackages.all();
    }
    return ApplicationsView.render(items, { packages: pkgs, open: ui.open });
  }

  function refresh() {
    if (currentRoute() === 'applications') navigate();
    else if (typeof renderNav === 'function') renderNav();
  }

  /* ---------- Sprint 23: application packages ----------
     A package is a prepared draft. Nothing here submits it — "Mark as
     Applied" only records that the user applied themselves. */

  function openPackage(id) {
    ui.open[id] = !ui.open[id];
    refresh();
  }

  function copyPackageCover(id) {
    if (typeof ApplicationPackages === 'undefined') return null;
    const r = ApplicationPackages.copyCoverLetter(id);
    if (typeof toast === 'function') toast(r.ok ? 'Cover letter copied to clipboard' : r.error, r.ok ? 'success' : 'error');
    return r;
  }

  function setPackageResume(id, resumeId) {
    if (typeof ApplicationPackages === 'undefined') return null;
    const pkg = ApplicationPackages.setResume(id, resumeId);
    if (pkg && typeof toast === 'function') {
      toast(`Package updated — cover letter rewritten for ${pkg.resumeName}`, 'info');
    }
    refresh();
    return pkg;
  }

  function markApplied(id) {
    if (typeof ApplicationPackages === 'undefined') return null;
    const pkg = ApplicationPackages.markApplied(id);
    if (!pkg) return null;
    /* promote it onto the existing board — once, never a duplicate card */
    if (!items.some(a => a.jobId === pkg.jobId)) {
      items.push(ApplicationsStore.fromJob(pkg.job, 'applied'));
      ApplicationsStore.save(items);
    }
    if (typeof toast === 'function') toast(`${pkg.job.company} marked as applied — tracked on the board`);
    refresh();
    return pkg;
  }

  /* re-read the board after an external write (used by the tests) */
  function reload() {
    items = ApplicationsStore.load();
  }

  /* ---------- queries (used by the dashboard) ---------- */

  function counts() {
    const c = { applied: 0, interview: 0, offer: 0, rejected: 0, total: items.length };
    items.forEach(a => {
      /* production lifecycle states map onto their board column;
         pre-application states don't count on the board (10A) */
      const col = ApplicationsStore.columnFor(a.status);
      if (col) c[col]++;
    });
    return c;
  }

  function getItems() {
    return items;
  }

  /* ---------- moving cards ---------- */

  function move(id, status) {
    const app = items.find(a => a.id === id);
    if (!app || app.status === status) return;
    app.status = status;
    ApplicationsStore.save(items);
    refresh();
    const label = ApplicationsView.COLS.find(c => c.id === status).label;
    toast(`${app.company} moved to ${label}`);
  }

  /* Stage badge <select> — the no-drag fallback (touch, keyboard) */
  function setStatus(id, status) {
    move(id, status);
  }

  /* ---------- drag & drop (vanilla HTML5 DnD) ---------- */

  function dragStart(e, id) {
    dragId = id;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    /* defer the class so the drag ghost keeps the card's normal look */
    setTimeout(() => e.target.classList.add('dragging'), 0);
  }

  function dragEnd(e) {
    dragId = null;
    e.target.classList.remove('dragging');
    document.querySelectorAll('.kbody.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  function dragOver(e) {
    e.preventDefault();                    // required to allow a drop
    e.dataTransfer.dropEffect = 'move';
  }

  function dragEnter(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function dragLeave(e) {
    /* ignore leave events fired while moving over child cards */
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drag-over');
    }
  }

  function drop(e, status) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain') || dragId;
    if (id) move(id, status);
    dragId = null;
  }

  return {
    render, counts, getItems,
    setStatus, move,
    dragStart, dragEnd, dragOver, dragEnter, dragLeave, drop,
    /* Sprint 23 */
    ui, reload, openPackage, copyPackageCover, setPackageResume, markApplied,
  };
})();
