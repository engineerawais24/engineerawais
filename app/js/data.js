/* ============================================================
   CareerPilot AI — Sprint 1 dummy data
   All sample/mock data lives here. No backend, no persistence:
   state resets on refresh (by design for Sprint 1).
   ============================================================ */

const DB = {

  user: { name: 'You', initials: 'YO', plan: 'Pro · 1 seat', role: 'Solutions Engineer' },

  lastSync: '6:00 AM',

  /* ---------- dashboard ----------
     Zeroed 2026-08-03 — every headline number here was invented (128
     applications, a 31% response rate, a $148k average). The dashboard now
     reports only what is really on the board; these fill in as you apply. */
  stats: [
    { k: 'Applications',   v: '0',  d: 'none yet',    up: false },
    { k: 'Interview rate', v: '0%', d: 'no data yet', up: false },
    { k: 'Response rate',  v: '0%', d: 'no data yet', up: false },
    { k: 'Avg salary',     v: '—',  d: 'target band', up: false },
  ],

  weekly: [
    { label: 'W1', pct: 0 }, { label: 'W2', pct: 0 }, { label: 'W3', pct: 0 },
    { label: 'W4', pct: 0 }, { label: 'W5', pct: 0 }, { label: 'W6', pct: 0 },
    { label: 'W7', pct: 0 }, { label: 'W8', pct: 0 },
  ],

  /* the monthly activity chart — no seeded history; the live months are
     computed from the Applications board at render time */
  monthly: [],

  pendingActions: [
    { color: '#3538CD', html: '<b>Complete your profile</b> — sharpens match scores', route: 'profile' },
  ],

  funnel: [
    { label: 'Applied',   n: 0, pct: 0, color: '#3538CD' },
    { label: 'Responded', n: 0, pct: 0, color: '#5A5CD6' },
    { label: 'Screened',  n: 0, pct: 0, color: '#8082E2' },
    { label: 'Onsite',    n: 0, pct: 0, color: '#A6A8EC' },
    { label: 'Offer',     n: 0, pct: 0, color: '#1E7A4D' },
  ],

  bestPerformers: [
    { k: 'Best performing resume', v: '—', d: 'no applications yet' },
    { k: 'Best job source',        v: '—', d: 'no applications yet' },
  ],

  /* ---------- today's jobs (sourced overnight, awaiting review) ----------
     Emptied 2026-08-03 — no demo jobs. Real jobs arrive from the extension /
     imports and are stored in `ImportedJobs`, never here. (Nothing reads this
     array; the board's own feed lives in jobs-store.js.) */
  jobs: [],

  /* ---------- approvals (tailored packages awaiting final sign-off) ----------
     Emptied 2026-08-03 — no demo approvals. Real approvals are pushed here at
     runtime when you approve a job on the board. */
  approvals: [],

  /* ---------- resume library ---------- */
  master: {
    title: 'You — Solutions Engineer',
    blurb: 'Single source of truth. Every tailored version is generated from this, never overwriting it.',
    skills: ['Terraform', 'Kubernetes', 'Python', 'Client delivery', 'Azure', 'SQL'],
    updated: 'Updated Jul 2',
  },

  variants: [
    { company: 'Stripe',    title: 'Sr Solutions Architect',   meta: '18 keywords matched · v3', ats: 94, tone: 'green' },
    { company: 'Microsoft', title: 'Technical Consultant',     meta: '15 keywords matched · v1', ats: 88, tone: 'green' },
    { company: 'Honeywell', title: 'Implementation Engineer',  meta: '13 keywords matched · v1', ats: 85, tone: 'amber' },
    { company: 'Vercel',    title: 'Solutions Engineer',       meta: '16 keywords matched · v2', ats: 91, tone: 'green' },
    { company: 'Datadog',   title: 'Technical Consultant',     meta: '12 keywords matched · v1', ats: 82, tone: 'amber' },
  ],

  /* ---------- applications tracker ----------
     Emptied 2026-08-03 — no demo applications. Real ones are added as you
     apply, and live in `ApplicationsStore` / `ApplicationPackages`. */
  applications: [],

  /* ---------- interview prep ---------- */
  interviews: [
    {
      id: 'iv1', company: 'Stripe', role: 'Sr Solutions Architect',
      stage: 'Tech screen · Jul 9, 2:00 PM',
      research: [
        'Payments infra scaling to new markets in 2026',
        'Solutions org owns enterprise onboarding + migrations',
        'Values: writing, low-ego, high ownership',
        'Recent: usage-based billing GA, Terraform provider v3',
      ],
      ask: [
        'How is SA success measured in year one?',
        'Biggest migration blocker for enterprise accounts?',
      ],
      tabs: {
        'Technical': {
          label: 'LIKELY AREA · INFRA & APIS',
          html: 'Expect deep-dives on <b>API design trade-offs</b>, idempotency in payment flows, and IaC review. Refresh: Terraform state strategies, K8s rollout patterns, webhook retry design.',
        },
        'System design': {
          label: 'PROMPT · DESIGN A MIGRATION',
          html: 'Practice: design a <b>zero-downtime billing migration</b> for 40 enterprise tenants. Cover dual-write, shadow reads, tier-staged cutover, rollback triggers, and observability gates.',
        },
        'Behavioral': {
          label: 'STAR ANSWER · MIGRATION UNDER PRESSURE',
          html: '<b>S</b> Legacy billing cutover, 3-day window. <b>T</b> Zero-downtime migration for 40 enterprise accounts. <b>A</b> Built dual-write + shadow-read validation, staged by tier. <b>R</b> Migrated with 0 revenue-impacting incidents; became the playbook.',
        },
        'HR': {
          label: 'TALKING POINTS · FIT & TIMELINE',
          html: 'Lead with fit for the Solutions org and written culture. Mention active timeline pressure (offer in hand) <b>without naming numbers first</b>. Availability: 2 weeks.',
        },
      },
      advice: 'Band ~$185k–$215k base. Anchor at $210k; you have a competing HashiCorp offer at $190k — lead with fit, mention timeline, don\'t name the number first.',
    },
    {
      id: 'iv2', company: 'Vercel', role: 'Solutions Engineer',
      stage: 'Recruiter call · Jul 10, 11:00 AM',
      research: [
        'Positioning around AI-app deployment and v0 workflows',
        'SE team pairs with enterprise accounts on migration to Next.js',
        'Recent: marketplace GA, edge functions pricing update',
      ],
      ask: [
        'What does the SE → account team hand-off look like?',
        'How much of the role is pre-sales vs post-sales?',
      ],
      tabs: {
        'Technical': {
          label: 'LIKELY AREA · WEB PLATFORM',
          html: 'Light screen expected. Be ready to talk <b>Next.js rendering modes</b>, edge vs serverless trade-offs, and one migration story with measurable outcomes.',
        },
        'System design': {
          label: 'PROMPT · EDGE-FIRST ARCHITECTURE',
          html: 'Sketch how you\'d move a monolith\'s landing + checkout to <b>edge rendering</b> while keeping the origin API: caching strategy, personalization, rollback.',
        },
        'Behavioral': {
          label: 'STAR ANSWER · STAKEHOLDER RESCUE',
          html: '<b>S</b> Enterprise pilot stalling, champion went quiet. <b>T</b> Recover the eval in 2 weeks. <b>A</b> Ran a working session, shipped a proof against their real repo. <b>R</b> Closed the pilot; expanded to 3 teams.',
        },
        'HR': {
          label: 'TALKING POINTS · RECRUITER SCREEN',
          html: 'Keep answers under 90 seconds. Confirm comp band early — target <b>$170k+ base</b>. Flag the Stripe process politely to set pace.',
        },
      },
      advice: 'Recruiter screens set the band anchor. Ask for their range before giving yours; if pushed, give “$170k–$185k depending on scope” and move on.',
    },
  ],

  /* ---------- settings ---------- */
  settings: {
    name: 'Mohammad Awais',
    email: 'engineer.awais24@gmail.com',
    targetRoles: 'Solutions Engineer, Solutions Architect, Technical Consultant',
    locations: 'Remote (US/EU), Dubai, Karachi',
    minSalary: 110,
    searchTime: '06:00',
    llm: 'Claude (Anthropic)',
    sources: { greenhouse: true, lever: true, ashby: true, rss: false },
    notif: { digest: true, followups: true, interviews: true },
    autoTailor: true,
  },
};
