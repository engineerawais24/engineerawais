/* ============================================================
   ApplicationsStore — persistence layer for the Job Tracker
   board. Single responsibility: defaults, load, save, clear.
   Backed by localStorage (key versioned for future migrations).
   ============================================================ */

const ApplicationsStore = (() => {

  const KEY = 'careerpilot_applications_v1';

  const STATUSES = ['applied', 'interview', 'offer', 'rejected'];

  /* Sample pipeline. Companies mirror the rest of the demo data
     (data.js) so the product feels coherent across screens. */
  function defaults() {
    return [
      { id: 'app1',  company: 'Stripe',    position: 'Sr Solutions Architect',    location: 'Remote · US',           applied: '2026-06-24', status: 'interview' },
      { id: 'app2',  company: 'HashiCorp', position: 'Professional Services Eng', location: 'Remote · US',           applied: '2026-06-10', status: 'offer' },
      { id: 'app3',  company: 'Vercel',    position: 'Solutions Engineer',        location: 'Remote · US',           applied: '2026-06-28', status: 'interview' },
      { id: 'app4',  company: 'Datadog',   position: 'Technical Consultant',      location: 'New York · Hybrid',     applied: '2026-07-01', status: 'applied' },
      { id: 'app5',  company: 'Figma',     position: 'Solutions Architect',       location: 'San Francisco · Hybrid', applied: '2026-06-30', status: 'applied' },
      { id: 'app6',  company: 'Notion',    position: 'Solutions Engineer',        location: 'San Francisco · Hybrid', applied: '2026-07-03', status: 'applied' },
      { id: 'app7',  company: 'Microsoft', position: 'Technical Consultant',      location: 'Dubai · On-site',       applied: '2026-07-06', status: 'applied' },
      { id: 'app8',  company: 'Honeywell', position: 'Implementation Engineer',   location: 'Karachi · On-site',     applied: '2026-07-07', status: 'applied' },
      { id: 'app9',  company: 'Airtable',  position: 'Implementation Engineer',   location: 'Remote · US',           applied: '2026-06-05', status: 'rejected' },
      { id: 'app10', company: 'Palantir',  position: 'Forward Deployed Engineer', location: 'Washington DC · On-site', applied: '2026-06-02', status: 'rejected' },
    ];
  }

  /* Load saved board; anything malformed falls back to defaults
     so a bad write can never blank the screen. */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return defaults();
      const valid = arr.filter(a => a && a.id && a.company && STATUSES.includes(a.status));
      return valid.length ? valid : defaults();
    } catch (e) {
      return defaults();
    }
  }

  function save(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, STATUSES, defaults, load, save, clear };
})();
