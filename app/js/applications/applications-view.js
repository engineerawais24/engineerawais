/* ============================================================
   ApplicationsView — pure rendering for the Job Tracker board.
   Takes the card list, returns HTML strings. No state of its
   own; all events call methods on the Applications controller.
   ============================================================ */

const ApplicationsView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Column definitions — single source for labels and colors,
     shared with the dashboard pipeline card via Applications. */
  const COLS = [
    { id: 'applied',   label: 'Applied',   dot: '#8B8272', color: 'var(--body)' },
    { id: 'interview', label: 'Interview', dot: '#3538CD', color: 'var(--accent)' },
    { id: 'offer',     label: 'Offer',     dot: '#1E7A4D', color: 'var(--green)' },
    { id: 'rejected',  label: 'Rejected',  dot: '#B23A2E', color: 'var(--red)' },
  ];

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* Status badge is a styled <select>: shows the stage AND works
     as the move fallback on touch devices without HTML5 DnD. */
  function statusBadge(a) {
    return `
      <select class="kstatus s-${a.status}" title="Move to stage"
              onchange="Applications.setStatus('${a.id}', this.value)">
        ${COLS.map(c => `<option value="${c.id}" ${c.id === a.status ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>`;
  }

  function card(a) {
    return `
      <article class="kcard" draggable="true" data-id="${a.id}"
               ondragstart="Applications.dragStart(event,'${a.id}')"
               ondragend="Applications.dragEnd(event)">
        <div class="ktop">
          <div class="kco">${esc(a.company)}</div>
          ${statusBadge(a)}
        </div>
        <div class="kpos">${esc(a.position)}</div>
        <div class="kmeta">
          <span>${esc(a.location)}</span>
          <span class="kdate">Applied ${fmtDate(a.applied)}</span>
        </div>
      </article>`;
  }

  function column(col, items) {
    return `
      <section class="kcol">
        <header class="kcol-head">
          <span class="kdot" style="background:${col.dot}"></span>
          <span class="kname">${col.label}</span>
          <span class="kcount">${items.length}</span>
        </header>
        <div class="kbody" data-col="${col.id}"
             ondragover="Applications.dragOver(event)"
             ondragenter="Applications.dragEnter(event)"
             ondragleave="Applications.dragLeave(event)"
             ondrop="Applications.drop(event,'${col.id}')">
          ${items.map(card).join('') || '<div class="kempty">Drop applications here</div>'}
        </div>
      </section>`;
  }

  function render(items) {
    return `
      <p class="screen-intro">Your pipeline at a glance. Drag cards between stages — or use the stage badge on any card. Changes are saved in this browser and reflected on the dashboard.</p>
      <div class="kboard">
        ${COLS.map(c => column(c, items.filter(a => a.status === c.id))).join('')}
      </div>`;
  }

  return { render, COLS };
})();
