/* ============================================================
   Theme — light/dark theme + accent color (Sprint 5).
   Works by stamping data-theme / data-accent on <html>; all
   colors are CSS variables, so polish.css overrides do the
   rest. Persisted to localStorage; index.html applies the
   saved choice inline before first paint to avoid flashing.
   ============================================================ */

const Theme = (() => {

  const KEY = 'careerpilot_ui_v1';
  const ACCENTS = ['indigo', 'forest', 'rust'];

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }

  function save(u) {
    try { localStorage.setItem(KEY, JSON.stringify(u)); } catch (e) { /* ignore */ }
  }

  function apply() {
    const u = get();
    const root = document.documentElement;
    if (u.theme === 'dark') root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    if (u.accent && u.accent !== 'indigo' && ACCENTS.includes(u.accent)) root.dataset.accent = u.accent;
    else delete root.dataset.accent;
  }

  function set(theme) {
    const u = get();
    u.theme = theme;
    save(u);
    apply();
    if (typeof currentRoute === 'function' && currentRoute() === 'settings') navigate();
    toast(`Switched to ${theme} theme`, 'info');
  }

  function setAccent(accent) {
    if (!ACCENTS.includes(accent)) return;
    const u = get();
    u.accent = accent;
    save(u);
    apply();
    if (typeof currentRoute === 'function' && currentRoute() === 'settings') navigate();
    toast(`Accent color: ${accent}`, 'info');
  }

  function init() { apply(); }

  return { KEY, ACCENTS, get, set, setAccent, init };
})();
