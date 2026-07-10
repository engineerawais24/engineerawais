/* ============================================================
   SourcesStore — job-source configuration (Sprint 8B).

   Four boards feed the daily search, each with:
     enabled     — on/off
     frequency   — 'Daily' | 'Twice daily' | 'Weekly' | 'Manual'
     priority    — 1..4; on duplicate jobs, the lowest number wins
     lastRun     — timestamp of the last successful search (null = never)
     status      — 'ready' | 'ok' | 'off'  (mock connection state)

   The Company Career Portals board crawls the configurable
   target-company portals below. lastSummary keeps the stats of
   the most recent daily-search run.
   ============================================================ */

const SourcesStore = (() => {

  const KEY = 'careerpilot_sources_v1';

  const BOARDS = [
    { id: 'linkedin',   label: 'LinkedIn Jobs' },
    { id: 'bayt',       label: 'Bayt' },
    { id: 'gulftalent', label: 'GulfTalent' },
    { id: 'careers',    label: 'Company Career Portals' },
  ];

  /* configurable target company portals (crawled via 'careers') */
  const PORTALS = [
    { id: 'cisco',     label: 'Cisco' },
    { id: 'accenture', label: 'Accenture' },
    { id: 'microsoft', label: 'Microsoft' },
    { id: 'ibm',       label: 'IBM' },
    { id: 'dell',      label: 'Dell Technologies' },
    { id: 'oracle',    label: 'Oracle' },
    { id: 'juniper',   label: 'Juniper' },
    { id: 'paloalto',  label: 'Palo Alto Networks' },
    { id: 'fortinet',  label: 'Fortinet' },
    { id: 'huawei',    label: 'Huawei' },
    { id: 'deloitte',  label: 'Deloitte' },
    { id: 'pwc',       label: 'PwC' },
    { id: 'ey',        label: 'EY' },
    { id: 'kpmg',      label: 'KPMG' },
  ];

  const FREQUENCIES = ['Daily', 'Twice daily', 'Weekly', 'Manual'];

  function defaults() {
    const boards = {};
    BOARDS.forEach((b, i) => {
      boards[b.id] = {
        enabled: true, frequency: 'Daily', priority: i + 1,
        /* connector diagnostics (Sprint 9A) */
        state: 'ready',          // ConnectorBase.STATES
        lastRun: null, lastSuccess: null,
        jobsFound: null, lastError: null,
        rateLimitedUntil: null, runs: 0,
      };
    });
    const portals = {};
    PORTALS.forEach(p => { portals[p.id] = true; });
    return { boards, portals, lastSummary: null };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved.boards) {
        for (const id of Object.keys(base.boards)) {
          if (saved.boards[id]) {
            Object.assign(base.boards[id], saved.boards[id]);
            /* migrate pre-9A status field to the state machine */
            if (saved.boards[id].status === 'ok' && !saved.boards[id].state) {
              base.boards[id].state = 'success';
            }
            delete base.boards[id].status;
          }
        }
      }
      if (saved.portals) {
        for (const id of Object.keys(base.portals)) {
          if (id in saved.portals) base.portals[id] = !!saved.portals[id];
        }
      }
      if (saved.lastSummary && typeof saved.lastSummary === 'object') base.lastSummary = saved.lastSummary;
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

  return { KEY, BOARDS, PORTALS, FREQUENCIES, defaults, load, save, clear };
})();
