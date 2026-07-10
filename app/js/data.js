/* ============================================================
   CareerPilot AI — Sprint 1 dummy data
   All sample/mock data lives here. No backend, no persistence:
   state resets on refresh (by design for Sprint 1).
   ============================================================ */

const DB = {

  user: { name: 'You', initials: 'YO', plan: 'Pro · 1 seat', role: 'Solutions Engineer' },

  lastSync: '6:00 AM',

  /* ---------- dashboard ---------- */
  stats: [
    { k: 'Applications',   v: '128',   d: '↑ 12 this week', up: true  },
    { k: 'Interview rate', v: '14%',   d: '↑ 3 pts',        up: true  },
    { k: 'Response rate',  v: '31%',   d: '40 replies',     up: false },
    { k: 'Avg salary',     v: '$148k', d: 'target band',    up: false },
  ],

  weekly: [
    { label: 'W1', pct: 38 }, { label: 'W2', pct: 52 }, { label: 'W3', pct: 44 },
    { label: 'W4', pct: 66 }, { label: 'W5', pct: 58 }, { label: 'W6', pct: 78 },
    { label: 'W7', pct: 70 }, { label: 'W8', pct: 90 },
  ],

  /* seeded history for the monthly activity chart — Jun/Jul are
     computed live from the Applications board at render time */
  monthly: [
    { m: 'Feb', n: 14 }, { m: 'Mar', n: 19 }, { m: 'Apr', n: 16 }, { m: 'May', n: 22 },
  ],

  pendingActions: [
    { color: '#3538CD', html: '<b>Complete your profile</b> — sharpens match scores', route: 'profile' },
    { color: '#B7791F', html: '<b>6 new matches</b> awaiting review', route: 'jobs' },
    { color: '#3538CD', html: '<b>3 tailored applications</b> ready to approve', route: 'approvals' },
    { color: '#1E7A4D', html: 'Prep <b>Stripe</b> tech screen · Jul 9', route: 'interview' },
    { color: '#8B8272', html: 'Follow up with <b>Datadog</b> — 5 days silent', route: 'tracker' },
  ],

  funnel: [
    { label: 'Applied',   n: 128, pct: 100, color: '#3538CD' },
    { label: 'Responded', n: 40,  pct: 31,  color: '#5A5CD6' },
    { label: 'Screened',  n: 22,  pct: 17,  color: '#8082E2' },
    { label: 'Onsite',    n: 11,  pct: 9,   color: '#A6A8EC' },
    { label: 'Offer',     n: 4,   pct: 4,   color: '#1E7A4D' },
  ],

  bestPerformers: [
    { k: 'Best performing resume', v: 'Solutions Architect v3', d: '34% reply · 5 interviews' },
    { k: 'Best job source',        v: 'Greenhouse + Ashby direct', d: '2.4× reply vs aggregators' },
  ],

  /* ---------- today's jobs (sourced overnight, awaiting review) ---------- */
  jobs: [
    {
      id: 'j1', score: 92, title: 'Senior Solutions Architect', company: 'Stripe',
      salary: '$185k–$215k', loc: 'Remote · US', mode: 'Full-time',
      reasons: ['Terraform + K8s match', 'Enterprise onboarding exp', 'Payments domain overlap'],
      missing: [], prob: '38%', status: 'pending',
    },
    {
      id: 'j2', score: 88, title: 'Staff Solutions Engineer', company: 'Cloudflare',
      salary: '$170k–$200k', loc: 'Remote · US', mode: 'Full-time',
      reasons: ['Edge infra keywords', 'Client delivery record'],
      missing: ['Rust exposure'], prob: '31%', status: 'pending',
    },
    {
      id: 'j3', score: 84, title: 'Technical Consultant', company: 'Datadog',
      salary: '$150k–$180k', loc: 'New York · Hybrid', mode: 'Full-time',
      reasons: ['Observability stack match', 'Python automation'],
      missing: ['On-site 2 days/wk'], prob: '27%', status: 'pending',
    },
    {
      id: 'j4', score: 79, title: 'Implementation Engineer', company: 'Retool',
      salary: '$140k–$165k', loc: 'Remote · US', mode: 'Full-time',
      reasons: ['API integration exp', 'SQL + JS match'],
      missing: ['Low-code platform exp'], prob: '22%', status: 'pending',
    },
    {
      id: 'j5', score: 74, title: 'Solutions Engineer', company: 'Notion',
      salary: '$135k–$160k', loc: 'San Francisco · Hybrid', mode: 'Full-time',
      reasons: ['Client-facing depth', 'Workflow automation'],
      missing: ['Relocation needed', 'Seniority stretch-down'], prob: '18%', status: 'pending',
    },
    {
      id: 'j6', score: 66, title: 'Forward Deployed Engineer', company: 'Palantir',
      salary: '$160k–$190k', loc: 'Washington DC · On-site', mode: 'Full-time',
      reasons: ['Python + delivery match'],
      missing: ['Clearance required', 'Full on-site'], prob: '11%', status: 'pending',
    },
  ],

  /* ---------- approvals (tailored packages awaiting final sign-off) ---------- */
  approvals: [
    {
      id: 'a1', company: 'Stripe', title: 'Sr Solutions Architect',
      resume: 'Stripe v3', ats: 94,
      cover: 'Leading with the zero-downtime billing migration story; mirrors their “high ownership” value and names the Terraform provider v3 launch…',
      changes: ['Reordered impact bullets', '+18 keywords matched', 'Tone: direct, low-ego'],
      when: 'Tailored 6:04 AM', status: 'awaiting',
    },
    {
      id: 'a2', company: 'Microsoft', title: 'Technical Consultant',
      resume: 'Microsoft v1', ats: 88,
      cover: 'Opens with Azure migration outcomes for regulated clients; maps consulting toolkit to their Industry Solutions delivery model…',
      changes: ['+15 keywords matched', 'Certifications surfaced', 'Trimmed to 1 page'],
      when: 'Tailored 6:07 AM', status: 'awaiting',
    },
    {
      id: 'a3', company: 'Honeywell', title: 'Implementation Engineer',
      resume: 'Honeywell v1', ats: 85,
      cover: 'Highlights industrial IoT rollout experience and on-site commissioning work; emphasizes safety-critical delivery…',
      changes: ['+13 keywords matched', 'Industrial projects first'],
      when: 'Tailored 6:11 AM', status: 'awaiting',
    },
  ],

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

  /* ---------- applications tracker ---------- */
  applications: [
    { company: 'Stripe',    position: 'Sr Solutions Architect', status: 'Interviewing', resume: 'Stripe v3',   salary: '$200k', next: 'Tech screen Jul 9',  nextTone: 'red' },
    { company: 'HashiCorp', position: 'Professional Services',  status: 'Offer',        resume: 'HC v2',       salary: '$190k', next: 'Decide by Jul 11',   nextTone: 'red' },
    { company: 'Vercel',    position: 'Solutions Engineer',     status: 'Screening',    resume: 'Vercel v2',   salary: '$175k', next: 'Recruiter call Jul 7', nextTone: 'body' },
    { company: 'Datadog',   position: 'Technical Consultant',   status: 'Applied',      resume: 'Datadog v1',  salary: '$165k', next: 'Follow up Jul 8',    nextTone: 'amber' },
    { company: 'Figma',     position: 'Solutions Architect',    status: 'Screening',    resume: 'Figma v1',    salary: '$180k', next: 'Awaiting scheduler', nextTone: 'body' },
    { company: 'Notion',    position: 'Solutions Engineer',     status: 'Applied',      resume: 'Notion v1',   salary: '$150k', next: '—',                  nextTone: 'ghost' },
    { company: 'Airtable',  position: 'Implementation Eng',     status: 'Rejected',     resume: 'Airtable v1', salary: '—',     next: '—',                  nextTone: 'ghost' },
  ],

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
