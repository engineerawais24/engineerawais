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
        company: '',
        startDate: '',
        type: 'Full-time',
        current: true,
        noticePeriod: '1 month',
      },
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
