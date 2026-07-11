/* ============================================================
   ApplicationsStore — persistence layer for the Job Tracker
   board. Single responsibility: defaults, load, save, clear.
   Backed by localStorage (key versioned for future migrations).

   Sprint 10A adds the PRODUCTION APPLICATION LIFECYCLE — the
   eleven states an application moves through once real
   connectors feed the pipeline. The Kanban board keeps its four
   columns unchanged; columnFor() maps every lifecycle state to
   its display column (pre-application states → null: they live
   in Today's Jobs / Approvals until the user applies).
   ============================================================ */

const ApplicationsStore = (() => {

  const KEY = 'careerpilot_applications_v1';

  const STATUSES = ['applied', 'interview', 'offer', 'rejected'];

  /* ---- production lifecycle (Sprint 10A) ---- */

  const PIPELINE_STATUSES = [
    { id: 'discovered',             label: 'Discovered',             column: null },
    { id: 'shortlisted',            label: 'Shortlisted',            column: null },
    { id: 'approved',               label: 'Approved',               column: null },
    { id: 'preparing_resume',       label: 'Preparing Resume',       column: null },
    { id: 'preparing_cover_letter', label: 'Preparing Cover Letter', column: null },
    { id: 'preparing_answers',      label: 'Preparing Answers',      column: null },   /* 10C */
    { id: 'ready_for_review',       label: 'Ready for Review',       column: null },   /* 10C */
    { id: 'ready_to_apply',         label: 'Ready To Apply',         column: null },
    { id: 'applied',                label: 'Applied',                column: 'applied' },
    { id: 'interview',              label: 'Interview',              column: 'interview' },
    { id: 'offer',                  label: 'Offer',                  column: 'offer' },
    { id: 'rejected',               label: 'Rejected',               column: 'rejected' },
    { id: 'withdrawn',              label: 'Withdrawn',              column: 'rejected' },
    { id: 'blocked_manual_review',  label: 'Blocked for Manual Review', column: null }, /* 10C hold state */
  ];

  const STATUS_IDS = PIPELINE_STATUSES.map(s => s.id);
  const byId = id => PIPELINE_STATUSES.find(s => s.id === id) || null;

  function isKnownStatus(id) {
    return STATUS_IDS.includes(id);
  }

  function statusLabel(id) {
    const s = byId(id);
    return s ? s.label : id;
  }

  /* board column an application renders in — null = not on the
     board yet (still pre-application in the discovery pipeline) */
  function columnFor(status) {
    const s = byId(status);
    return s ? s.column : null;
  }

  /* allowed transitions: one step forward through the lifecycle,
     plus rejected/withdrawn from any non-terminal state.
     10C: preparation states can be put on hold for manual review;
     resolving the hold returns the package to ready_for_review. */
  const TERMINAL = ['offer', 'rejected', 'withdrawn'];
  const CAN_BLOCK = ['preparing_resume', 'preparing_cover_letter', 'preparing_answers', 'ready_for_review'];

  function nextStatuses(status) {
    if (status === 'blocked_manual_review') return ['ready_for_review', 'rejected', 'withdrawn'];
    const i = STATUS_IDS.indexOf(status);
    if (i === -1 || TERMINAL.includes(status)) return [];
    const next = [];
    const forward = STATUS_IDS[i + 1];
    if (forward && !TERMINAL.includes(forward) && forward !== 'blocked_manual_review') next.push(forward);
    if (forward === 'offer') next.push('offer');
    if (CAN_BLOCK.includes(status)) next.push('blocked_manual_review');
    next.push('rejected', 'withdrawn');
    return next;
  }

  function canTransition(from, to) {
    return nextStatuses(from).includes(to);
  }

  /* production factory: a discovered/approved job becomes a
     tracked application (used once the approval flow promotes
     a job — never automatically) */
  function fromJob(job, status = 'discovered') {
    return {
      id: 'app-' + (job.id || Date.now()),
      company: job.company, position: job.title,
      location: job.location || '',
      applied: new Date().toISOString().slice(0, 10),
      status: isKnownStatus(status) ? status : 'discovered',
      jobId: job.id || null, source: job.source || null,
    };
  }

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
      const valid = arr.filter(a => a && a.id && a.company && isKnownStatus(a.status));
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

  return {
    KEY, STATUSES, defaults, load, save, clear,
    /* production lifecycle (Sprint 10A) */
    PIPELINE_STATUSES, isKnownStatus, statusLabel,
    columnFor, nextStatuses, canTransition, fromJob,
  };
})();
