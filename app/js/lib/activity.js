/* ============================================================
   Activity — persisted activity log (Sprint 5). Feeds the
   dashboard "Recent activity" timeline. Entries come from
   Notify (every toast is an action) plus seeded sample events.
   Lazy-initialized so it works no matter the load order.
   ============================================================ */

const Activity = (() => {

  const KEY = 'careerpilot_activity_v1';
  const CAP = 30;
  let items = null;

  /* Emptied 2026-08-03 — the timeline starts empty and fills with what you
     actually do. It used to seed five invented events (a Stripe package, a
     HashiCorp offer, a Honeywell application), which re-appeared every time the
     stored log was cleared. */
  function seed() {
    return [];
  }

  function ensure() {
    if (items) return;
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : null;
      items = Array.isArray(arr) ? arr : seed();
    } catch (e) {
      items = seed();
    }
    save();
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
  }

  function log(type, msg) {
    ensure();
    items.unshift({ t: Date.now(), type, msg: String(msg).replace(/</g, '&lt;') });
    if (items.length > CAP) items.length = CAP;
    save();
  }

  function recent(n = 8) {
    ensure();
    return [...items].sort((a, b) => b.t - a.t).slice(0, n);
  }

  /* relative timestamp: "just now" → "5m ago" → "3h ago" → "Jul 5" */
  function rel(t) {
    const d = Date.now() - t;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.round(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.round(d / 3600e3) + 'h ago';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function init() { ensure(); }

  return { KEY, init, log, recent, rel };
})();
