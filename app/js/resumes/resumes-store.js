/* ============================================================
   ResumesStore — persistence + sample content for the Resume
   Builder. Single responsibility: defaults, load, save, clear,
   plus static sample data (experience, education, role keywords).
   Backed by localStorage (key versioned for future migrations).
   ============================================================ */

const ResumesStore = (() => {

  const KEY = 'careerpilot_documents_v1';

  /* Sample work history rendered into the resume preview.
     Editable history arrives with the backend; for now this
     complements the live Profile data (Sprint 2). */
  const EXPERIENCE = [
    {
      title: 'Solutions Engineer', company: 'TechVantage Systems', period: '2023 — Present',
      bullets: [
        'Own technical evaluations for enterprise prospects across the Gulf region — 14 PoCs delivered, 9 converted.',
        'Designed Azure landing zones with Terraform, cutting client onboarding from 3 weeks to 4 days.',
        'Built the internal demo platform (Python + FastAPI) now used by the entire pre-sales team.',
      ],
    },
    {
      title: 'Cloud Engineer', company: 'Netsol Technologies', period: '2021 — 2023',
      bullets: [
        'Migrated 40+ production workloads to Kubernetes with zero-downtime cutovers.',
        'Introduced infrastructure-as-code review gates, cutting config-drift incidents by 70%.',
      ],
    },
    {
      title: 'Systems Analyst', company: 'Systems Ltd', period: '2019 — 2021',
      bullets: [
        'Automated reporting pipelines in SQL and Python, saving ~20 analyst-hours per week.',
      ],
    },
  ];

  const EDUCATION = [
    { degree: 'BS Computer Science', school: 'FAST-NUCES, Karachi', year: '2019' },
  ];

  /* Keywords the mock "matcher" expects per role family. The
     suggestions panel compares these against Profile skills. */
  const ROLE_KEYWORDS = [
    { match: /architect/i,               kws: ['Terraform', 'Kubernetes', 'Cloud migration', 'Architecture reviews', 'Stakeholder management'] },
    { match: /consultant/i,              kws: ['Client delivery', 'Azure', 'Requirements discovery', 'SQL', 'Workshops'] },
    { match: /implementation|deployed/i, kws: ['Python', 'API integration', 'On-site commissioning', 'SQL', 'Client training'] },
    { match: /engineer|services/i,       kws: ['Python', 'Kubernetes', 'Client delivery', 'PoC delivery', 'Technical demos'] },
  ];

  function keywordsFor(position) {
    const hit = ROLE_KEYWORDS.find(r => r.match.test(position || ''));
    return hit ? hit.kws : ['Client delivery', 'Python', 'Communication', 'Cloud fundamentals'];
  }

  /* ---------- persisted document state ---------- */

  function defaults() {
    return {
      variants: [
        { id: 'var1', company: 'Stripe',    title: 'Sr Solutions Architect',  meta: '18 keywords matched · v3', ats: 94, appId: 'app1' },
        { id: 'var2', company: 'Vercel',    title: 'Solutions Engineer',      meta: '16 keywords matched · v2', ats: 91, appId: 'app3' },
        { id: 'var3', company: 'Microsoft', title: 'Technical Consultant',    meta: '15 keywords matched · v1', ats: 88, appId: 'app7' },
        { id: 'var4', company: 'Honeywell', title: 'Implementation Engineer', meta: '13 keywords matched · v1', ats: 85, appId: 'app8' },
        { id: 'var5', company: 'Datadog',   title: 'Technical Consultant',    meta: '12 keywords matched · v1', ats: 82, appId: 'app4' },
      ],
      coverLetters: {},   // appId -> letter text
      lastAppId: null,
    };
  }

  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.variants) && saved.variants.length) base.variants = saved.variants;
      if (saved.coverLetters && typeof saved.coverLetters === 'object') base.coverLetters = saved.coverLetters;
      if (typeof saved.lastAppId === 'string') base.lastAppId = saved.lastAppId;
    } catch (e) {
      /* corrupt JSON or storage blocked — fall back to defaults */
    }
    return base;
  }

  function save(docs) {
    try {
      localStorage.setItem(KEY, JSON.stringify(docs));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, EXPERIENCE, EDUCATION, keywordsFor, defaults, load, save, clear };
})();
