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

  function seed() {
    const now = Date.now();
    const DAY = 864e5;
    return [
      { t: now - 12 * 60e3,     type: 'info',    msg: 'Daily search finished — 6 new matches scored' },
      { t: now - 9 * 60e3,      type: 'success', msg: 'Stripe application package tailored (ATS 94)' },
      { t: now - 1 * DAY,       type: 'info',    msg: 'Applied to Honeywell — Implementation Engineer' },
      { t: now - 2 * DAY,       type: 'success', msg: 'Offer received from HashiCorp — $190k base' },
      { t: now - 3 * DAY,       type: 'info',    msg: 'Tech screen scheduled with Stripe · Jul 9' },
    ];
  }

  function ensure() {
    if (items) return;
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : null;
      items = Array.isArray(arr) && arr.length ? arr : seed();
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
