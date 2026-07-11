/* ============================================================
   Applications — controller for the Job Tracker board.
   Owns the card list and the drag-and-drop flow (vanilla
   HTML5 DnD, no libraries). Rendering is delegated to
   ApplicationsView, persistence to ApplicationsStore.
   ============================================================ */

const Applications = (() => {

  let items = ApplicationsStore.load();   // in-memory working copy
  let dragId = null;                      // card being dragged

  /* ---------- rendering ---------- */

  function render() {
    return ApplicationsView.render(items);
  }

  function refresh() {
    if (currentRoute() === 'applications') navigate();
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
  };
})();
