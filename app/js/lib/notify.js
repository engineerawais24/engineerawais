/* ============================================================
   Notify — stacked toast notification system (Sprint 5).
   Types: success · info · warn · error. Every toast is also
   logged to the Activity timeline so the dashboard reflects
   what actually happened. The global toast() helper keeps
   every existing call site working unchanged.
   ============================================================ */

const Notify = (() => {

  const TYPE_ICON = { success: 'check', info: 'zap', warn: 'alert', error: 'alert' };
  const MAX_STACK = 4;

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function container() {
    let el = document.getElementById('toasts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toasts';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(msg, type = 'success') {
    if (!TYPE_ICON[type]) type = 'info';
    const box = container();
    const el = document.createElement('div');
    el.className = 'ntoast ' + type;
    el.innerHTML = `<span class="nt-ic">${Icons.get(TYPE_ICON[type], 13)}</span><span class="nt-msg">${esc(msg)}</span>`;
    box.appendChild(el);
    while (box.children.length > MAX_STACK) box.children[0].remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2800);
    if (typeof Activity !== 'undefined') Activity.log(type, msg);
    return el;
  }

  return { toast };
})();

/* global helper — existing modules call toast(msg) everywhere */
function toast(msg, type) {
  return Notify.toast(msg, type);
}
