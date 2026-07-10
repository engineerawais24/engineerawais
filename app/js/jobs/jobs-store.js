/* ============================================================
   JobsStore — the unified Job model + sourced jobs (Sprint 8A).

   UNIFIED JOB MODEL — every sourced job, regardless of board,
   is normalized into this shape. The backend crawlers (LinkedIn,
   Bayt, GulfTalent, company career pages) emit exactly this:

   {
     id:              string          — stable id for decisions/sync
     company:         string
     title:           string
     description:     string          — short summary of the posting
     skills:          string[]        — required skills/keywords
     location:        string          — 'Dubai · Hybrid', 'Remote · US'…
     workMode:        'Remote' | 'Hybrid' | 'On-site'
     employmentType:  'Full-time' | 'Contract' | 'Part-time'
     salary:          number|string|null — annual, thousands of `currency`
                                          (number), or text like
                                          'Competitive'/'Negotiable'/'DOE',
                                          or null when unknown
     salaryMax:       number|null     — top of a disclosed range
     currency:        'USD'|'AED'|'SAR'|'PKR'|'GBP'|'EUR'
     salaryDisclosed: boolean         — false → NEVER filtered on salary
     source:          'LinkedIn'|'Bayt'|'GulfTalent'|'Company Careers'
     applyUrl:        string          — original posting URL
     postedDate:      'YYYY-MM-DD'
     visaSponsorship: boolean
     companyLogo:     string|null     — logo URL once the backend serves
                                        them; UI falls back to a monogram
     languagesRequired: string[]      — languages named by the posting
   }

   Decisions (approve / reject / later) persist per job id.
   No live scraping here — SAMPLE_JOBS stands in for the crawlers.
   ============================================================ */

const JobsStore = (() => {

  const KEY = 'careerpilot_jobs_v1';

  const SOURCES = ['LinkedIn', 'Bayt', 'GulfTalent', 'Company Careers'];

  const SAMPLE_JOBS = [
    {
      id: 'job1', company: 'Stripe', title: 'Staff Solutions Architect',
      description: 'Own the technical architecture for enterprise payment migrations and partner with sales on complex evaluations.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Stakeholder management', 'Payments'],
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 185, salaryMax: 215, currency: 'USD', salaryDisclosed: true,
      source: 'LinkedIn', applyUrl: 'https://stripe.com/jobs/listing/staff-solutions-architect',
      postedDate: '2026-07-09', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job2', company: 'Careem', title: 'Senior Solutions Engineer',
      description: 'Deliver platform integrations for super-app partners across the Middle East; own PoCs end-to-end.',
      skills: ['Python', 'Kubernetes', 'Client delivery', 'API integration'],
      location: 'Dubai · Hybrid', workMode: 'Hybrid', employmentType: 'Full-time',
      salary: 540, salaryMax: 600, currency: 'AED', salaryDisclosed: true,
      source: 'Bayt', applyUrl: 'https://www.bayt.com/en/uae/jobs/senior-solutions-engineer-careem',
      postedDate: '2026-07-08', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job3', company: 'Emirates NBD', title: 'Cloud Solutions Consultant',
      description: 'Advise on Azure landing zones and migration factories for the bank\'s digital transformation.',
      skills: ['Azure', 'Terraform', 'Requirements discovery', 'Banking'],
      location: 'Dubai · On-site', workMode: 'On-site', employmentType: 'Full-time',
      salary: 440, salaryMax: 480, currency: 'AED', salaryDisclosed: true,
      source: 'GulfTalent', applyUrl: 'https://www.gulftalent.com/uae/jobs/cloud-solutions-consultant-enbd',
      postedDate: '2026-07-07', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job4', company: 'Vercel', title: 'Solutions Engineer',
      description: 'Pair with enterprise accounts on Next.js migrations and edge architecture reviews.',
      skills: ['Next.js', 'Client delivery', 'Technical demos', 'Kubernetes'],
      location: 'Remote · US/EU', workMode: 'Remote', employmentType: 'Full-time',
      salary: 'Competitive', salaryMax: null, currency: 'USD', salaryDisclosed: false,
      source: 'Company Careers', applyUrl: 'https://vercel.com/careers/solutions-engineer',
      postedDate: '2026-07-09', visaSponsorship: false, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job5', company: 'Datadog', title: 'Technical Consultant',
      description: 'Guide enterprise observability rollouts; workshops, dashboards-as-code, migration playbooks.',
      skills: ['Python', 'Kubernetes', 'Workshops', 'Observability'],
      location: 'New York · Hybrid', workMode: 'Hybrid', employmentType: 'Full-time',
      salary: 150, salaryMax: 180, currency: 'USD', salaryDisclosed: true,
      source: 'LinkedIn', applyUrl: 'https://careers.datadoghq.com/detail/technical-consultant',
      postedDate: '2026-07-06', visaSponsorship: false, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job6', company: 'Microsoft', title: 'Technical Specialist — Azure',
      description: 'Own technical wins for Azure infrastructure deals across Gulf enterprise accounts.',
      skills: ['Azure', 'Terraform', 'Stakeholder management', 'SQL'],
      location: 'Dubai · Hybrid', workMode: 'Hybrid', employmentType: 'Full-time',
      salary: null, salaryMax: null, currency: 'AED', salaryDisclosed: false,
      source: 'Company Careers', applyUrl: 'https://careers.microsoft.com/v2/global/en/job/azure-technical-specialist',
      postedDate: '2026-07-10', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job7', company: 'Retool', title: 'Implementation Engineer',
      description: 'Build internal tools with strategic customers; SQL + JavaScript heavy, high customer contact.',
      skills: ['SQL', 'API integration', 'Client delivery', 'JavaScript'],
      location: 'San Francisco · On-site', workMode: 'On-site', employmentType: 'Full-time',
      salary: 125, salaryMax: 150, currency: 'USD', salaryDisclosed: true,
      source: 'LinkedIn', applyUrl: 'https://retool.com/careers/implementation-engineer',
      postedDate: '2026-07-05', visaSponsorship: false, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job8', company: 'Saudi Telecom (stc)', title: 'Solutions Consultant',
      description: 'Pre-sales consulting for cloud and IoT offerings to government and enterprise clients.',
      skills: ['Requirements discovery', 'Workshops', 'Cloud fundamentals'],
      location: 'Riyadh · On-site', workMode: 'On-site', employmentType: 'Full-time',
      salary: 380, salaryMax: 420, currency: 'SAR', salaryDisclosed: true,
      source: 'Bayt', applyUrl: 'https://www.bayt.com/en/saudi-arabia/jobs/solutions-consultant-stc',
      postedDate: '2026-07-04', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English', 'Arabic'],
    },
    {
      id: 'job9', company: 'HashiCorp', title: 'Sr Professional Services Engineer',
      description: 'Deliver Terraform and Vault engagements for regulated enterprises; deep IaC review work.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Client delivery'],
      location: 'Remote · US', workMode: 'Remote', employmentType: 'Full-time',
      salary: 170, salaryMax: 200, currency: 'USD', salaryDisclosed: true,
      source: 'LinkedIn', applyUrl: 'https://www.hashicorp.com/careers/sr-professional-services-engineer',
      postedDate: '2026-07-08', visaSponsorship: false, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job10', company: 'noon', title: 'Platform Solutions Lead',
      description: 'Lead marketplace seller-platform integrations; heavy stakeholder work across the region.',
      skills: ['API integration', 'Stakeholder management', 'SQL'],
      location: 'Dubai · On-site', workMode: 'On-site', employmentType: 'Full-time',
      salary: 'Negotiable', salaryMax: null, currency: 'AED', salaryDisclosed: false,
      source: 'GulfTalent', applyUrl: 'https://www.gulftalent.com/uae/jobs/platform-solutions-lead-noon',
      postedDate: '2026-07-09', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English', 'Arabic'],
    },
    {
      id: 'job11', company: 'Palantir', title: 'Forward Deployed Engineer',
      description: 'Embed with clients to ship data-driven applications on Foundry; travel expected.',
      skills: ['Python', 'SQL', 'Client delivery'],
      location: 'London · On-site', workMode: 'On-site', employmentType: 'Full-time',
      salary: 'DOE', salaryMax: null, currency: 'GBP', salaryDisclosed: false,
      source: 'Company Careers', applyUrl: 'https://www.palantir.com/careers/forward-deployed-engineer-london',
      postedDate: '2026-07-03', visaSponsorship: true, companyLogo: null,
      languagesRequired: ['English'],
    },
    {
      id: 'job12', company: 'Systems Limited', title: 'Senior Solutions Architect',
      description: 'Architect cloud solutions for Gulf and North American clients from the Karachi delivery center.',
      skills: ['Azure', 'Terraform', 'Kubernetes', 'Client delivery'],
      location: 'Karachi · Hybrid', workMode: 'Hybrid', employmentType: 'Full-time',
      salary: null, salaryMax: null, currency: 'PKR', salaryDisclosed: false,
      source: 'Bayt', applyUrl: 'https://www.bayt.com/en/pakistan/jobs/senior-solutions-architect-systems',
      postedDate: '2026-07-10', visaSponsorship: false, companyLogo: null,
      languagesRequired: ['English', 'Urdu'],
    },
  ];

  function jobs() {
    return SAMPLE_JOBS;
  }

  /* ---------- persisted decisions ---------- */

  function load() {
    const base = { decisions: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.decisions === 'object') base.decisions = saved.decisions;
    } catch (e) { /* fall through to defaults */ }
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

  return { KEY, SOURCES, jobs, load, save, clear };
})();
