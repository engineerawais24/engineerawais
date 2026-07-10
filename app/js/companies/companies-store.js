/* ============================================================
   CompaniesStore — company preference tiers (Sprint 8C).

   Tier 1 (highest) and Tier 2 (high) are explicit, editable
   lists; every other company is Tier 3 (standard). `boosting`
   is the master switch for all ranking adjustments.
   Persisted to localStorage; users can move companies between
   tiers, add custom companies, and remove them (removal drops
   a company back to Tier 3).
   ============================================================ */

const CompaniesStore = (() => {

  const KEY = 'careerpilot_companies_v1';

  function defaults() {
    return {
      boosting: true,
      tier1: ['Cisco', 'Microsoft', 'Accenture', 'Dell Technologies',
              'Oracle', 'IBM', 'Google', 'Amazon Web Services'],
      tier2: ['Juniper Networks', 'Fortinet', 'Palo Alto Networks', 'Huawei',
              'Deloitte', 'PwC', 'EY', 'KPMG'],
    };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (typeof saved.boosting === 'boolean') base.boosting = saved.boosting;
      ['tier1', 'tier2'].forEach(t => {
        if (Array.isArray(saved[t]) && saved[t].every(c => typeof c === 'string')) base[t] = saved[t];
      });
    } catch (e) { /* corrupt → defaults */ }
    return base;
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 &]/g, '').trim();

  /* Loose matching so 'Palo Alto Networks' claims a posting from
     'Palo Alto Networks MEA' and 'EY' doesn't swallow everything
     (both-direction contains, with a short-name exact guard). */
  function matches(listName, company) {
    const a = norm(listName);
    const b = norm(company);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length <= 3 || b.length <= 3) return false;   // EY/IBM-style names need exact
    return b.includes(a) || a.includes(b);
  }

  function tierOf(company, cfg) {
    const c = cfg || load();
    if (c.tier1.some(n => matches(n, company))) return 1;
    if (c.tier2.some(n => matches(n, company))) return 2;
    return 3;
  }

  return { KEY, defaults, load, save, clear, tierOf, matches };
})();
