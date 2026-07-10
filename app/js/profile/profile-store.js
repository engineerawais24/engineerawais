/* ============================================================
   ProfileStore — persistence layer for the Career Profile.
   Single responsibility: defaults, load, save, clear.
   Backed by localStorage (key versioned for future migrations).
   ============================================================ */

const ProfileStore = (() => {

  const KEY = 'careerpilot_profile_v1';

  /* Fresh default profile. Sample data mirrors the master resume
     in data.js so the demo feels coherent. */
  function defaults() {
    return {
      personal: {
        firstName: 'Mohammad',
        lastName: 'Awais',
        headline: 'Solutions Engineer',
        summary: 'Solutions engineer with a focus on cloud infrastructure and client delivery. Comfortable owning technical evaluations end-to-end, from discovery workshops to production rollout.',
      },
      contact: {
        email: 'engineer.awais24@gmail.com',
        phone: '',
        city: 'Karachi',
        country: 'Pakistan',
      },
      links: {
        linkedin: '',
        github: '',
        portfolio: '',
        other: '',
      },
      employment: {
        title: 'Solutions Engineer',
        company: 'TechVantage Systems',
        startDate: '2023-01',
        type: 'Full-time',
        current: true,
        noticePeriod: '1 month',
        highlights: 'Own technical evaluations for enterprise prospects across the Gulf region — 14 PoCs delivered, 9 converted.\nDesigned Azure landing zones with Terraform, cutting client onboarding from 3 weeks to 4 days.\nBuilt the internal demo platform (Python + FastAPI) now used by the entire pre-sales team.',
      },

      /* Employment history — the structure the future AI parser fills.
         Each entry has a stable `id` (so backend sync can reconcile)
         and a `source` marking provenance: 'manual' now, 'ai-parse'
         once uploaded resumes are parsed server-side. `highlights`
         is newline-separated; each line becomes a resume bullet. */
      history: [
        {
          id: 'emp-1', company: 'Netsol Technologies', title: 'Cloud Engineer',
          location: 'Karachi, Pakistan', startDate: '2021-03', endDate: '2023-01', current: false,
          highlights: 'Migrated 40+ production workloads to Kubernetes with zero-downtime cutovers.\nIntroduced infrastructure-as-code review gates, cutting config-drift incidents by 70%.',
          source: 'manual',
        },
        {
          id: 'emp-2', company: 'Systems Ltd', title: 'Systems Analyst',
          location: 'Karachi, Pakistan', startDate: '2019-06', endDate: '2021-03', current: false,
          highlights: 'Automated reporting pipelines in SQL and Python, saving ~20 analyst-hours per week.',
          source: 'manual',
        },
      ],
      skills: ['Terraform', 'Kubernetes', 'Python', 'Client delivery', 'Azure', 'SQL'],
      certifications: [
        { name: 'AZ-104 Azure Administrator', issuer: 'Microsoft', year: '2024' },
      ],
      languages: [
        { name: 'English', level: 'Fluent' },
        { name: 'Urdu', level: 'Native' },
      ],
      preferences: {
        targetRoles: 'Solutions Engineer, Solutions Architect, Technical Consultant',
        locations: 'Remote (US/EU), Dubai, Karachi',
        minSalary: 140,
        workMode: 'Remote',
        jobType: 'Full-time',
        relocation: true,
      },
      authorization: {
        status: 'Citizen',
        authorizedIn: 'Pakistan',
        sponsorship: true,
      },
    };
  }

  /* Load saved profile, section-merged over defaults so newly added
     fields get sane values even for profiles saved by older versions. */
  function load() {
    const base = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      for (const section of Object.keys(base)) {
        if (!(section in saved)) continue;
        if (Array.isArray(base[section])) {
          base[section] = saved[section];
        } else {
          Object.assign(base[section], saved[section]);
        }
      }
    } catch (e) {
      /* corrupt JSON or storage blocked — fall back to defaults */
    }
    return base;
  }

  function save(profile) {
    try {
      localStorage.setItem(KEY, JSON.stringify(profile));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function hasSaved() {
    try { return localStorage.getItem(KEY) !== null; } catch (e) { return false; }
  }

  return { KEY, defaults, load, save, clear, hasSaved };
})();
