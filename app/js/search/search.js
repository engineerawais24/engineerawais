/* ============================================================
   Search — global application search (Sprint 5). Lives in the
   top bar; matches board applications by company, position,
   location, and the role's skill keywords. Selecting a result
   jumps to the Applications board and flashes the card.
   Ctrl+K (or Cmd+K) focuses the search box.
   ============================================================ */

const Search = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const STATUS_PILL = { applied: 'pill-neutral', interview: 'pill-indigo', offer: 'pill-green', rejected: 'pill-red' };

  /* haystack per application: company + position + location + role skills */
  function results(q) {
    q = (q || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return Applications.getItems().filter(a =>
      [a.company, a.position, a.location, ...ResumesStore.keywordsFor(a.position)]
        .join(' ').toLowerCase().includes(q)
    ).slice(0, 7);
  }

  function row(a) {
    return `
      <button class="gs-row" onmousedown="Search.go('${a.id}')">
        <b>${esc(a.company)}</b>
        <span class="gs-pos">${esc(a.position)}</span>
        <span class="gs-loc">${esc(a.location)}</span>
        <span class="pill ${STATUS_PILL[a.status] || 'pill-neutral'}" style="font-size:9.5px">${a.status}</span>
      </button>`;
  }

  function onInput(v) {
    const drop = document.getElementById('gs-drop');
    if (!drop) return;
    if (!v || v.trim().length < 2) {
      drop.hidden = true;
      drop.innerHTML = '';
      return;
    }
    const r = results(v);
    drop.innerHTML = r.length
      ? r.map(row).join('')
      : `<div class="gs-empty">No applications match “${esc(v.trim())}” — try a company, role, city or skill.</div>`;
    drop.hidden = false;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.target.value = '';
      onInput('');
      e.target.blur();
    }
    if (e.key === 'Enter') {
      const first = results(e.target.value)[0];
      if (first) go(first.id);
    }
  }

  function onBlur() {
    /* delay so a result mousedown lands first */
    setTimeout(() => {
      const drop = document.getElementById('gs-drop');
      if (drop) drop.hidden = true;
    }, 150);
  }

  function go(id) {
    const input = document.getElementById('gsearch-input');
    if (input) input.value = '';
    onInput('');
    location.hash = '#/applications';
    navigate();
    setTimeout(() => {
      const card = document.querySelector(`.kcard[data-id="${id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('khl');
        setTimeout(() => card.classList.remove('khl'), 2000);
      }
    }, 80);
  }

  function init() {
    const icon = document.getElementById('gs-icon');
    if (icon) icon.innerHTML = Icons.get('search', 14);
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('gsearch-input')?.focus();
      }
    });
  }

  return { init, results, onInput, onKey, onBlur, go };
})();
