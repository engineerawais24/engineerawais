/* ============================================================
   Connectors — production connector registry (Sprint 9A → 10A).

   EIGHT adapters on the same ConnectorBase interface:
     LinkedIn Jobs · Bayt · GulfTalent · Company Career Portals
     Greenhouse · Lever · Workday · SmartRecruiters

   Each source keeps a RAW demo feed in its provider's NATIVE
   shape (the same shape its real API returns), plus a normalizer
   raw → JobSchema.normalized(). That makes the normalizers the
   exact functions a live backend will run — plugging in a real
   provider later means swapping the fixture for an HTTP call and
   nothing else. Every adapter supports query / location /
   work-mode / posted-date filtering and pagination against its
   demo feed today; live mode routes through the backend
   integration contract in connector-base.js.

   No scraping, browser automation or external APIs here.
   ============================================================ */

const Connectors = (() => {

  const today = () => new Date().toISOString().slice(0, 10);
  const canon = url => (url || '').split(/[?#]/)[0];
  const origin = url => (String(url || '').match(/^https:\/\/[^/]+/) || [null])[0];

  /* ---------- RAW feeds (board-native shapes) ---------- */

  const LINKEDIN_RAW = [
    { jobId: '88231', position: 'Staff Solutions Architect', org: 'Stripe',
      blurb: 'Own the technical architecture for enterprise payment migrations and partner with sales on complex evaluations.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Stakeholder management', 'Payments'],
      nice: ['GraphQL'],
      place: 'Remote · US', mode: 'Remote', type: 'Full-time',
      payShown: true, payMin: 185, payMax: 215, payCur: 'USD', payPeriod: 'year',
      url: 'https://www.linkedin.com/jobs/view/88231?refId=track&trk=feed', listedOn: '2026-07-09',
      sponsor: true, reloAssist: false, langs: ['English'] },
    { jobId: '88544', position: 'Technical Consultant', org: 'Datadog',
      blurb: 'Guide enterprise observability rollouts; workshops, dashboards-as-code, migration playbooks.',
      skills: ['Python', 'Kubernetes', 'Workshops', 'Observability'],
      place: 'New York · Hybrid', mode: 'Hybrid', type: 'Full-time',
      payShown: true, payMin: 150, payMax: 180, payCur: 'USD', payPeriod: 'year',
      url: 'https://www.linkedin.com/jobs/view/88544?src=alert', listedOn: '2026-07-06',
      sponsor: false, reloAssist: false, langs: ['English'] },
    { jobId: '88710', position: 'Implementation Engineer', org: 'Retool',
      blurb: 'Build internal tools with strategic customers; SQL + JavaScript heavy, high customer contact.',
      skills: ['SQL', 'API integration', 'Client delivery', 'JavaScript'],
      place: 'San Francisco · On-site', mode: 'On-site', type: 'Full-time',
      payShown: true, payMin: 125, payMax: 150, payCur: 'USD', payPeriod: 'year',
      url: 'https://www.linkedin.com/jobs/view/88710', listedOn: '2026-07-05',
      sponsor: false, reloAssist: true, langs: ['English'] },
    { jobId: '88902', position: 'Sr Professional Services Engineer', org: 'HashiCorp',
      blurb: 'Deliver Terraform and Vault engagements for regulated enterprises; deep IaC review work.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Client delivery'],
      place: 'Remote · US', mode: 'Remote', type: 'Full-time',
      payShown: true, payMin: 170, payMax: 200, payCur: 'USD', payPeriod: 'year',
      url: 'https://www.linkedin.com/jobs/view/88902?utm_campaign=jobs', listedOn: '2026-07-08',
      sponsor: false, reloAssist: false, langs: ['English'] },
    /* duplicate of the Microsoft careers-portal posting — dedupe demo */
    { jobId: '89055', position: 'Technical Specialist — Azure', org: 'Microsoft',
      blurb: 'Own technical wins for Azure infrastructure deals across Gulf enterprise accounts.',
      skills: ['Azure', 'Terraform', 'Stakeholder management', 'SQL'],
      place: 'Dubai · Hybrid', mode: 'Hybrid', type: 'Full-time',
      payShown: false, payMin: null, payMax: null, payCur: 'AED', payPeriod: 'year',
      url: 'https://www.linkedin.com/jobs/view/89055?trk=mirror', listedOn: '2026-07-10',
      sponsor: true, reloAssist: false, langs: ['English'] },
  ];

  const BAYT_RAW = [
    { ref: 'BYT-4411', title: 'Senior Solutions Engineer', employer: 'Careem',
      summary: 'Deliver platform integrations for super-app partners across the Middle East; own PoCs end-to-end.',
      keywords: ['Python', 'Kubernetes', 'Client delivery', 'API integration'],
      niceToHave: ['Arabic'],
      city: 'Dubai · Hybrid', arrangement: 'Hybrid', contract: 'Full-time',
      disclosed: true, salaryFrom: 540, salaryTo: 600, cur: 'AED', per: 'year',
      link: 'https://www.bayt.com/en/uae/jobs/4411?jbsrc=email', date: '2026-07-08',
      visa: true, languages: ['English'] },
    { ref: 'BYT-4523', title: 'Solutions Consultant', employer: 'Saudi Telecom (stc)',
      summary: 'Pre-sales consulting for cloud and IoT offerings to government and enterprise clients.',
      keywords: ['Requirements discovery', 'Workshops', 'Cloud fundamentals'],
      city: 'Riyadh · On-site', arrangement: 'On-site', contract: 'Full-time',
      disclosed: true, salaryFrom: 350, salaryTo: 390, cur: 'SAR', per: 'year',
      link: 'https://www.bayt.com/en/saudi-arabia/jobs/4523', date: '2026-07-04',
      visa: true, languages: ['English', 'Arabic'] },
    { ref: 'BYT-4610', title: 'Senior Solutions Architect', employer: 'Systems Limited',
      summary: 'Architect cloud solutions for Gulf and North American clients from the Karachi delivery center.',
      keywords: ['Azure', 'Terraform', 'Kubernetes', 'Client delivery'],
      city: 'Karachi · Hybrid', arrangement: 'Hybrid', contract: 'Full-time',
      disclosed: false, salaryFrom: null, salaryTo: null, cur: 'PKR', per: 'year',
      link: 'https://www.bayt.com/en/pakistan/jobs/4610', date: '2026-07-10',
      visa: false, languages: ['English', 'Urdu'] },
    /* monthly-quoted Gulf role — compares against your SAR/month minimum */
    { ref: 'BYT-4688', title: 'Digital Solutions Engineer', employer: 'Aramco Digital',
      summary: 'Build and integrate digital platforms for energy-sector programs; Riyadh-based delivery team.',
      keywords: ['Python', 'API integration', 'SQL', 'Client delivery'],
      city: 'Riyadh · On-site', arrangement: 'On-site', contract: 'Full-time',
      disclosed: true, salaryFrom: 38000, salaryTo: null, cur: 'SAR', per: 'month',
      link: 'https://www.bayt.com/en/saudi-arabia/jobs/4688?src=featured', date: '2026-07-09',
      visa: true, languages: ['English'] },
  ];

  const GULFTALENT_RAW = [
    { gtId: 'GT-9902', role: 'Cloud Solutions Consultant', firm: 'Emirates NBD',
      about: 'Advise on Azure landing zones and migration factories for the bank\'s digital transformation.',
      tags: ['Azure', 'Terraform', 'Requirements discovery', 'Banking'],
      location: 'Dubai · On-site', workStyle: 'On-site', engagement: 'Full-time',
      showPay: true, payLow: 340, payHigh: 380, payCurrency: 'AED', payBasis: 'year',
      href: 'https://www.gulftalent.com/uae/jobs/9902?ref=digest', posted: '2026-07-07',
      sponsorship: true, langNeeds: ['English'] },
    { gtId: 'GT-9974', role: 'Platform Solutions Lead', firm: 'noon',
      about: 'Lead marketplace seller-platform integrations; heavy stakeholder work across the region.',
      tags: ['API integration', 'Stakeholder management', 'SQL'],
      location: 'Dubai · On-site', workStyle: 'On-site', engagement: 'Full-time',
      showPay: false, payText: 'Negotiable', payCurrency: 'AED', payBasis: 'year',
      href: 'https://www.gulftalent.com/uae/jobs/9974', posted: '2026-07-09',
      sponsorship: true, langNeeds: ['English', 'Arabic'] },
    /* duplicate of the Bayt Careem posting — dedupe demo */
    { gtId: 'GT-9988', role: 'Senior Solutions Engineer', firm: 'Careem',
      about: 'Deliver platform integrations for super-app partners across the Middle East; own PoCs end-to-end.',
      tags: ['Python', 'Kubernetes', 'Client delivery', 'API integration'],
      location: 'Dubai · Hybrid', workStyle: 'Hybrid', engagement: 'Full-time',
      showPay: true, payLow: 540, payHigh: 600, payCurrency: 'AED', payBasis: 'year',
      href: 'https://www.gulftalent.com/uae/jobs/9988?ref=mirror', posted: '2026-07-09',
      sponsorship: true, langNeeds: ['English'] },
    /* monthly role below the AED/month minimum — filtered by rule */
    { gtId: 'GT-9991', role: 'Technical Support Consultant', firm: 'e& (Etisalat)',
      about: 'Enterprise connectivity solutions consulting for UAE government accounts.',
      tags: ['Requirements discovery', 'SQL'],
      location: 'Abu Dhabi · On-site', workStyle: 'On-site', engagement: 'Full-time',
      showPay: true, payLow: 22000, payHigh: null, payCurrency: 'AED', payBasis: 'month',
      href: 'https://www.gulftalent.com/uae/jobs/9991', posted: '2026-07-08',
      sponsorship: true, langNeeds: ['English'] },
  ];

  /* portal key must match SourcesStore.PORTALS ids — a disabled
     portal's postings are skipped by the careers connector */
  const CAREERS_RAW = [
    { portal: 'microsoft', reqId: 'MS-77120', roleTitle: 'Technical Specialist — Azure',
      desc: 'Own technical wins for Azure infrastructure deals across Gulf enterprise accounts.',
      stack: ['Azure', 'Terraform', 'Stakeholder management', 'SQL'],
      loc: 'Dubai · Hybrid', modeOfWork: 'Hybrid', engType: 'Full-time',
      compShown: false, compText: null, compCur: 'AED', compBasis: 'year',
      applyLink: 'https://careers.microsoft.com/v2/global/en/job/MS-77120?src=portal', firstSeen: '2026-07-10',
      visaHelp: true, languages: ['English'], companyName: 'Microsoft' },
    { portal: 'cisco', reqId: 'CSC-3301', roleTitle: 'Solutions Architect — Global Enterprise',
      desc: 'Architect secure network and cloud solutions for global enterprise accounts in the Gulf region.',
      stack: ['Networking', 'Kubernetes', 'Stakeholder management', 'Cloud fundamentals'],
      loc: 'Dubai · Hybrid', modeOfWork: 'Hybrid', engType: 'Full-time',
      compShown: false, compText: 'Competitive', compCur: 'USD', compBasis: 'year',
      applyLink: 'https://jobs.cisco.com/global/en/job/CSC-3301', firstSeen: '2026-07-09',
      visaHelp: true, languages: ['English'], companyName: 'Cisco' },
    { portal: 'oracle', reqId: 'ORC-5540', roleTitle: 'Cloud Solutions Engineer',
      desc: 'OCI workload architecture and hands-on PoCs for enterprise accounts across MEA.',
      stack: ['Terraform', 'SQL', 'Client delivery', 'Cloud fundamentals'],
      loc: 'Dubai · Hybrid', modeOfWork: 'Hybrid', engType: 'Full-time',
      compShown: true, compMin: 28000, compMax: null, compCur: 'AED', compBasis: 'month',
      applyLink: 'https://careers.oracle.com/jobs/ORC-5540?source=direct', firstSeen: '2026-07-09',
      visaHelp: true, languages: ['English'], companyName: 'Oracle' },
    { portal: 'paloalto', reqId: 'PAN-8873', roleTitle: 'Systems Engineer — Cortex',
      desc: 'Pre-sales security engineering for Cortex platform deals with Saudi enterprise customers.',
      stack: ['Python', 'API integration', 'Technical demos'],
      loc: 'Riyadh · Hybrid', modeOfWork: 'Hybrid', engType: 'Full-time',
      compShown: true, compMin: 32000, compMax: null, compCur: 'SAR', compBasis: 'month',
      applyLink: 'https://jobs.paloaltonetworks.com/job/PAN-8873', firstSeen: '2026-07-08',
      visaHelp: true, languages: ['English'], companyName: 'Palo Alto Networks' },
    { portal: 'deloitte', reqId: 'DTT-1029', roleTitle: 'Technology Consultant — Cloud',
      desc: 'Cloud transformation consulting across Gulf public-sector and financial clients.',
      stack: ['Azure', 'Requirements discovery', 'Workshops', 'Stakeholder management'],
      loc: 'Dubai · Hybrid', modeOfWork: 'Hybrid', engType: 'Full-time',
      compShown: false, compText: 'DOE', compCur: 'AED', compBasis: 'year',
      applyLink: 'https://jobs.deloitte.com/middleeast/en/job/DTT-1029?src=li', firstSeen: '2026-07-07',
      visaHelp: true, languages: ['English'], companyName: 'Deloitte' },
  ];

  /* Greenhouse Job Board API — GET boards-api.greenhouse.io/v1/boards/{org}/jobs?content=true */
  const GREENHOUSE_RAW = [
    { id: 4402011, company_name: 'Databricks', title: 'Solutions Architect — EMEA',
      absolute_url: 'https://boards.greenhouse.io/databricks/jobs/4402011?gh_src=digest',
      updated_at: '2026-07-09', location: { name: 'Remote - EU' },
      content: 'Design lakehouse architectures with strategic EMEA customers; hands-on PoCs, workshops and migration guidance.',
      departments: [{ name: 'Field Engineering' }],
      metadata: [{ name: 'salary_min', value: '160000' }, { name: 'salary_max', value: '190000' },
                 { name: 'salary_currency', value: 'USD' }],
      keywords: ['Python', 'SQL', 'Terraform', 'Client delivery', 'Workshops'], nice: ['Spark'],
      employment: 'Full-time', visa: false, relo: false, langs: ['English'],
      careers: 'https://www.databricks.com/company/careers' },
    { id: 4407788, company_name: 'Figma', title: 'Solutions Consultant',
      absolute_url: 'https://boards.greenhouse.io/figma/jobs/4407788',
      updated_at: '2026-07-08', location: { name: 'San Francisco, CA' },
      content: 'Partner with enterprise design orgs on rollout, integrations and adoption programs.',
      departments: [{ name: 'Customer Experience' }],
      metadata: [{ name: 'salary_min', value: '140000' }, { name: 'salary_max', value: '165000' },
                 { name: 'salary_currency', value: 'USD' }],
      keywords: ['API integration', 'Client delivery', 'Workshops'], nice: [],
      employment: 'Full-time', visa: false, relo: false, langs: ['English'],
      careers: 'https://www.figma.com/careers' },
    /* duplicate of the LinkedIn Stripe posting — cross-ATS dedupe demo */
    { id: 4409120, company_name: 'Stripe', title: 'Staff Solutions Architect',
      absolute_url: 'https://boards.greenhouse.io/stripe/jobs/4409120?gh_src=mirror',
      updated_at: '2026-07-09', location: { name: 'Remote - US' },
      content: 'Own the technical architecture for enterprise payment migrations and partner with sales on complex evaluations.',
      departments: [{ name: 'Solutions Architecture' }],
      metadata: [{ name: 'salary_min', value: '185000' }, { name: 'salary_max', value: '215000' },
                 { name: 'salary_currency', value: 'USD' }],
      keywords: ['Terraform', 'Kubernetes', 'Python', 'Stakeholder management', 'Payments'], nice: [],
      employment: 'Full-time', visa: true, relo: false, langs: ['English'],
      careers: 'https://stripe.com/jobs' },
  ];

  /* Lever Postings API — GET api.lever.co/v0/postings/{org}?mode=json */
  const LEVER_RAW = [
    { id: 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d', text: 'Solutions Engineer — MENA',
      categories: { team: 'Sales Engineering', location: 'Remote - EMEA', commitment: 'Full-time' },
      workplaceType: 'remote', createdAt: 1783728000000,
      hostedUrl: 'https://jobs.lever.co/deel/a1b2c3d4?lever-source=email',
      descriptionPlain: 'Run technical evaluations for MENA prospects; own integrations, demos and security reviews for global-payroll deals.',
      lists: [{ text: 'Requirements', content: 'Python; API integration; Technical demos; Client delivery' }],
      salaryRange: { min: 140000, max: 170000, currency: 'USD', interval: 'per-year-salary' },
      preferred: ['Arabic'], posted: '2026-07-10',
      visa: false, relo: false, langs: ['English'],
      careers: 'https://www.deel.com/careers' },
    /* duplicate of the Greenhouse Databricks posting — dedupe demo */
    { id: 'f9e8d7c6-b5a4-4392-8170-6f5e4d3c2b1a', text: 'Solutions Architect — EMEA',
      categories: { team: 'Field Engineering', location: 'Remote - EU', commitment: 'Full-time' },
      workplaceType: 'remote', createdAt: 1783641600000,
      hostedUrl: 'https://jobs.lever.co/databricks/f9e8d7c6?lever-source=mirror',
      descriptionPlain: 'Design lakehouse architectures with strategic EMEA customers; hands-on PoCs, workshops and migration guidance.',
      lists: [{ text: 'Requirements', content: 'Python; SQL; Terraform; Client delivery; Workshops' }],
      salaryRange: { min: 160000, max: 190000, currency: 'USD', interval: 'per-year-salary' },
      preferred: ['Spark'], posted: '2026-07-09',
      visa: false, relo: false, langs: ['English'],
      careers: 'https://www.databricks.com/company/careers' },
  ];

  /* Workday CXS — POST {tenant}.wd3.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
     (Workday rarely discloses pay → these test the unknown-salary rule) */
  const WORKDAY_RAW = [
    { jobReqId: 'JR100482', title: 'Technology Solutions Architect',
      externalPath: '/job/Riyadh-Saudi-Arabia/Technology-Solutions-Architect_JR100482',
      locationsText: 'Riyadh, Saudi Arabia', remoteType: 'On-site', timeType: 'Full time',
      postedOn: '2026-07-09',
      jobDescription: 'Architect smart-city technology platforms across giga-project workstreams; vendor evaluation and integration governance.',
      requiredSkills: ['Azure', 'Kubernetes', 'Stakeholder management', 'Requirements discovery'],
      preferredSkills: ['Arabic'],
      externalUrl: 'https://neom.wd3.myworkdayjobs.com/en-US/NEOM/job/JR100482?source=digest',
      company: 'NEOM', visaSupport: true, reloSupport: true, langs: ['English'],
      careers: 'https://careers.neom.com' },
    { jobReqId: 'JR220915', title: 'Senior Solutions Engineer — Group IT',
      externalPath: '/job/Dubai-UAE/Senior-Solutions-Engineer_JR220915',
      locationsText: 'Dubai, UAE', remoteType: 'On-site', timeType: 'Full time',
      postedOn: '2026-07-08',
      jobDescription: 'Deliver integration solutions across airline commercial systems; high-scale APIs and enterprise middleware.',
      requiredSkills: ['API integration', 'SQL', 'Client delivery'],
      preferredSkills: [],
      externalUrl: 'https://emiratesgroupcareers.wd3.myworkdayjobs.com/en-US/Emirates/job/JR220915',
      company: 'Emirates Group', visaSupport: true, reloSupport: false, langs: ['English'],
      careers: 'https://www.emiratesgroupcareers.com' },
  ];

  /* SmartRecruiters Posting API — GET api.smartrecruiters.com/v1/companies/{company}/postings */
  const SMARTRECRUITERS_RAW = [
    { id: '744000048221', name: 'Client Solutions Architect',
      releasedDate: '2026-07-09',
      location: { city: 'Dubai', country: 'ae', remote: false, hybrid: true },
      typeOfEmployment: { label: 'Full-time' },
      company: { name: 'Visa' },
      jobAd: { sections: {
        jobDescription: { text: 'Design payment-acceptance architectures with Gulf issuers and fintechs; lead technical workshops.' },
        qualifications: { text: 'Payments; API integration; Stakeholder management; Technical demos' } } },
      compensation: { min: 30000, max: null, currency: 'AED', period: 'month', disclosed: true },
      preferred: ['Arabic'],
      postingUrl: 'https://jobs.smartrecruiters.com/Visa/744000048221?src=alert',
      visaSupport: true, reloSupport: false, langs: ['English'],
      careers: 'https://corporate.visa.com/en/careers' },
    /* monthly pay below the AED/month minimum — filtered by rule */
    { id: '744000051077', name: 'Integration Engineer — Partner Platforms',
      releasedDate: '2026-07-08',
      location: { city: 'Dubai', country: 'ae', remote: false, hybrid: false },
      typeOfEmployment: { label: 'Full-time' },
      company: { name: 'talabat' },
      jobAd: { sections: {
        jobDescription: { text: 'Build partner-facing integrations for the delivery platform; webhooks, APIs and onboarding tooling.' },
        qualifications: { text: 'API integration; SQL; JavaScript' } } },
      compensation: { min: 20000, max: null, currency: 'AED', period: 'month', disclosed: true },
      preferred: [],
      postingUrl: 'https://jobs.smartrecruiters.com/talabat/744000051077',
      visaSupport: true, reloSupport: false, langs: ['English'],
      careers: 'https://careers.talabat.com' },
  ];

  /* ---------- normalizers: raw → JobSchema contract ---------- */

  function fromLinkedIn(r) {
    return JobSchema.normalized({
      id: 'li-' + r.jobId, company: r.org, title: r.position, description: r.blurb,
      skills: r.skills, preferredSkills: r.nice || [],
      location: r.place, workMode: r.mode, employmentType: r.type,
      salary: r.payShown ? r.payMin : null, salaryMax: r.payShown ? r.payMax : null,
      currency: r.payCur || 'USD', salaryDisclosed: !!r.payShown, salaryPeriod: r.payPeriod || 'year',
      source: 'LinkedIn', applyUrl: r.url, postedDate: r.listedOn, companyCareerPage: null,
      visaSponsorship: !!r.sponsor, relocationSupport: !!r.reloAssist, companyLogo: null, languagesRequired: r.langs || [],
      originalSource: 'LinkedIn', sourceJobId: 'li-' + r.jobId, canonicalUrl: canon(r.url),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.listedOn, lastChecked: today(),
    });
  }

  function fromBayt(r) {
    return JobSchema.normalized({
      id: 'bt-' + r.ref, company: r.employer, title: r.title, description: r.summary,
      skills: r.keywords, preferredSkills: r.niceToHave || [],
      location: r.city, workMode: r.arrangement, employmentType: r.contract,
      salary: r.disclosed ? r.salaryFrom : null, salaryMax: r.disclosed ? r.salaryTo : null,
      currency: r.cur, salaryDisclosed: !!r.disclosed, salaryPeriod: r.per || 'year',
      source: 'Bayt', applyUrl: r.link, postedDate: r.date, companyCareerPage: null,
      visaSponsorship: !!r.visa, relocationSupport: !!r.relocationHelp, companyLogo: null, languagesRequired: r.languages || [],
      originalSource: 'Bayt', sourceJobId: r.ref, canonicalUrl: canon(r.link),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.date, lastChecked: today(),
    });
  }

  function fromGulfTalent(r) {
    return JobSchema.normalized({
      id: 'gt-' + r.gtId, company: r.firm, title: r.role, description: r.about,
      skills: r.tags, preferredSkills: r.plus || [],
      location: r.location, workMode: r.workStyle, employmentType: r.engagement,
      salary: r.showPay ? r.payLow : (r.payText || null), salaryMax: r.showPay ? r.payHigh : null,
      currency: r.payCurrency, salaryDisclosed: !!r.showPay, salaryPeriod: r.payBasis || 'year',
      source: 'GulfTalent', applyUrl: r.href, postedDate: r.posted, companyCareerPage: null,
      visaSponsorship: !!r.sponsorship, relocationSupport: !!r.reloSupport, companyLogo: null, languagesRequired: r.langNeeds || [],
      originalSource: 'GulfTalent', sourceJobId: r.gtId, canonicalUrl: canon(r.href),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.posted, lastChecked: today(),
    });
  }

  function fromCareersPortal(r) {
    return JobSchema.normalized({
      id: 'cc-' + r.reqId, company: r.companyName, title: r.roleTitle, description: r.desc,
      skills: r.stack, preferredSkills: r.plusSkills || [],
      location: r.loc, workMode: r.modeOfWork, employmentType: r.engType,
      salary: r.compShown ? r.compMin : (r.compText || null), salaryMax: r.compShown ? (r.compMax || null) : null,
      currency: r.compCur, salaryDisclosed: !!r.compShown, salaryPeriod: r.compBasis || 'year',
      source: 'Company Careers', applyUrl: r.applyLink, postedDate: r.firstSeen,
      companyCareerPage: origin(r.applyLink),
      visaSponsorship: !!r.visaHelp, relocationSupport: !!r.relocationPkg, companyLogo: null, languagesRequired: r.languages || [],
      originalSource: 'Company Careers', sourceJobId: r.reqId, canonicalUrl: canon(r.applyLink),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.firstSeen, lastChecked: today(),
    });
  }

  /* the sign says Remote in many provider location strings */
  const modeFrom = (text, fallback) => /remote/i.test(String(text)) ? 'Remote' : fallback;

  function fromGreenhouse(r) {
    const meta = {};
    (r.metadata || []).forEach(m => { meta[m.name] = m.value; });
    const disclosed = meta.salary_min != null;
    const locName = (r.location && r.location.name) || '';
    const mode = modeFrom(locName, 'On-site');
    return JobSchema.normalized({
      company: r.company_name, title: r.title, description: r.content,
      skills: r.keywords || [], preferredSkills: r.nice || [],
      location: mode === 'Remote' ? locName.replace(/\s*-\s*/, ' · ') : locName.split(',')[0] + ' · ' + mode,
      workMode: mode, employmentType: r.employment || 'Full-time',
      salary: disclosed ? Math.round(Number(meta.salary_min) / 1000) : null,
      salaryMax: disclosed && meta.salary_max ? Math.round(Number(meta.salary_max) / 1000) : null,
      currency: meta.salary_currency || 'USD', salaryDisclosed: disclosed, salaryPeriod: 'year',
      source: 'Greenhouse', applyUrl: r.absolute_url, postedDate: r.updated_at,
      companyCareerPage: r.careers || null,
      visaSponsorship: !!r.visa, relocationSupport: !!r.relo, languagesRequired: r.langs || [],
      sourceJobId: String(r.id), firstDiscovered: r.updated_at,
    });
  }

  function fromLever(r) {
    const req = (r.lists || []).find(l => /requirement/i.test(l.text));
    const skills = req ? req.content.split(/;\s*/).filter(Boolean) : [];
    const sr = r.salaryRange || null;
    const monthly = sr && /month/i.test(sr.interval || '');
    const loc = (r.categories && r.categories.location) || '';
    const mode = r.workplaceType === 'remote' ? 'Remote'
      : r.workplaceType === 'hybrid' ? 'Hybrid' : modeFrom(loc, 'On-site');
    return JobSchema.normalized({
      company: (r.hostedUrl.match(/jobs\.lever\.co\/([^/]+)/) || [, ''])[1].replace(/^\w/, c => c.toUpperCase()),
      title: r.text, description: r.descriptionPlain,
      skills, preferredSkills: r.preferred || [],
      location: mode === 'Remote' ? loc.replace(/\s*-\s*/, ' · ') : loc + ' · ' + mode,
      workMode: mode, employmentType: (r.categories && r.categories.commitment) || 'Full-time',
      salary: sr ? (monthly ? sr.min : Math.round(sr.min / 1000)) : null,
      salaryMax: sr && sr.max ? (monthly ? sr.max : Math.round(sr.max / 1000)) : null,
      currency: (sr && sr.currency) || 'USD', salaryDisclosed: !!sr,
      salaryPeriod: monthly ? 'month' : 'year',
      source: 'Lever', applyUrl: r.hostedUrl, postedDate: r.posted || new Date(r.createdAt).toISOString().slice(0, 10),
      companyCareerPage: r.careers || null,
      visaSponsorship: !!r.visa, relocationSupport: !!r.relo, languagesRequired: r.langs || [],
      sourceJobId: r.id,
    });
  }

  function fromWorkday(r) {
    return JobSchema.normalized({
      company: r.company, title: r.title, description: r.jobDescription,
      skills: r.requiredSkills || [], preferredSkills: r.preferredSkills || [],
      location: r.locationsText.split(',')[0] + ' · ' + (r.remoteType || 'On-site'),
      workMode: r.remoteType || 'On-site',
      employmentType: /full/i.test(r.timeType || '') ? 'Full-time' : (r.timeType || 'Full-time'),
      salary: null, salaryMax: null, salaryDisclosed: false,   // Workday rarely discloses pay
      currency: /Saudi/i.test(r.locationsText) ? 'SAR' : 'AED',
      source: 'Workday', applyUrl: r.externalUrl, postedDate: r.postedOn,
      companyCareerPage: r.careers || null,
      visaSponsorship: !!r.visaSupport, relocationSupport: !!r.reloSupport, languagesRequired: r.langs || [],
      sourceJobId: r.jobReqId,
    });
  }

  function fromSmartRecruiters(r) {
    const sec = (r.jobAd && r.jobAd.sections) || {};
    const skills = sec.qualifications ? sec.qualifications.text.split(/;\s*/).filter(Boolean) : [];
    const comp = r.compensation || null;
    const disclosed = !!(comp && comp.disclosed);
    const mode = r.location.remote ? 'Remote' : (r.location.hybrid ? 'Hybrid' : 'On-site');
    return JobSchema.normalized({
      company: (r.company && r.company.name) || '', title: r.name,
      description: sec.jobDescription ? sec.jobDescription.text : '',
      skills, preferredSkills: r.preferred || [],
      location: r.location.city + ' · ' + mode, workMode: mode,
      employmentType: (r.typeOfEmployment && r.typeOfEmployment.label) || 'Full-time',
      salary: disclosed ? comp.min : null, salaryMax: disclosed ? (comp.max || null) : null,
      currency: (comp && comp.currency) || 'USD', salaryDisclosed: disclosed,
      salaryPeriod: comp && comp.period === 'month' ? 'month' : 'year',
      source: 'SmartRecruiters', applyUrl: r.postingUrl, postedDate: r.releasedDate,
      companyCareerPage: r.careers || null,
      visaSponsorship: !!r.visaSupport, relocationSupport: !!r.reloSupport, languagesRequired: r.langs || [],
      sourceJobId: r.id,
    });
  }

  /* ---------- adapters (ConnectorBase interface) ---------- */

  const CAPABILITIES = {
    query: true, location: true, workMode: true, postedSince: true,
    pagination: true, salary: true, sponsorshipFlags: true,
  };

  /* enabled target portals gate the careers demo feed */
  function enabledPortals() {
    return (typeof SourcesStore !== 'undefined') ? SourcesStore.load().portals : {};
  }

  const ADAPTERS = {
    linkedin: ConnectorBase.createAdapter({
      id: 'linkedin', label: 'LinkedIn Jobs', authType: 'session',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'sessionRef'],
      normalize: fromLinkedIn,
      demoFeed: () => LINKEDIN_RAW.map(fromLinkedIn),
    }),
    bayt: ConnectorBase.createAdapter({
      id: 'bayt', label: 'Bayt', authType: 'api_key',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],
      normalize: fromBayt,
      demoFeed: () => BAYT_RAW.map(fromBayt),
    }),
    gulftalent: ConnectorBase.createAdapter({
      id: 'gulftalent', label: 'GulfTalent', authType: 'api_key',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],
      normalize: fromGulfTalent,
      demoFeed: () => GULFTALENT_RAW.map(fromGulfTalent),
    }),
    careers: ConnectorBase.createAdapter({
      id: 'careers', label: 'Company Career Portals', authType: 'none',
      capabilities: CAPABILITIES,
      requires: ['endpoint'],
      normalize: fromCareersPortal,
      demoFeed: () => {
        const portals = enabledPortals();
        return CAREERS_RAW.filter(r => portals[r.portal]).map(fromCareersPortal);
      },
    }),
    /* — ATS providers (Sprint 10A) — */
    greenhouse: ConnectorBase.createAdapter({
      id: 'greenhouse', label: 'Greenhouse', authType: 'none',
      capabilities: CAPABILITIES,
      requires: ['endpoint'],               // public Job Board API — no key
      normalize: fromGreenhouse,
      demoFeed: () => GREENHOUSE_RAW.map(fromGreenhouse),
    }),
    lever: ConnectorBase.createAdapter({
      id: 'lever', label: 'Lever', authType: 'none',
      capabilities: CAPABILITIES,
      requires: ['endpoint'],               // public Postings API — no key
      normalize: fromLever,
      demoFeed: () => LEVER_RAW.map(fromLever),
    }),
    workday: ConnectorBase.createAdapter({
      id: 'workday', label: 'Workday', authType: 'oauth2',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],  // per-tenant CXS gateway
      normalize: fromWorkday,
      demoFeed: () => WORKDAY_RAW.map(fromWorkday),
    }),
    smartrecruiters: ConnectorBase.createAdapter({
      id: 'smartrecruiters', label: 'SmartRecruiters', authType: 'api_key',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],
      normalize: fromSmartRecruiters,
      demoFeed: () => SMARTRECRUITERS_RAW.map(fromSmartRecruiters),
    }),
  };

  function get(id) {
    return ADAPTERS[id] || null;
  }

  function all() {
    return Object.values(ADAPTERS);
  }

  function isConfigured(id) {
    const a = get(id);
    return a ? a.isConfigured() : false;
  }

  return {
    get, all, isConfigured,
    fromLinkedIn, fromBayt, fromGulfTalent, fromCareersPortal,
    fromGreenhouse, fromLever, fromWorkday, fromSmartRecruiters,
  };
})();
