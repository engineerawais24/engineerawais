/* ============================================================
   Connectors — real connector foundation (Sprint 9A).

   Four adapters (LinkedIn Jobs, Bayt, GulfTalent, Company
   Career Portals) built on the ConnectorBase adapter interface.
   Each supports query / location / work-mode / posted-date
   filtering and pagination against its DEMO feed today; live
   mode routes through the backend integration contract in
   connector-base.js. The raw feeds below stay as the demo
   fallback and double as the normalizer fixtures.

   No scraping, browser automation or external APIs here.
   ============================================================ */

const Connectors = (() => {

  const today = () => new Date().toISOString().slice(0, 10);
  const canon = url => (url || '').split(/[?#]/)[0];

  /* ---------- RAW feeds (board-native shapes) ---------- */

  const LINKEDIN_RAW = [
    { jobId: '88231', position: 'Staff Solutions Architect', org: 'Stripe',
      blurb: 'Own the technical architecture for enterprise payment migrations and partner with sales on complex evaluations.',
      skills: ['Terraform', 'Kubernetes', 'Python', 'Stakeholder management', 'Payments'],
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

  /* ---------- normalizers: raw → unified Job model ---------- */

  function fromLinkedIn(r) {
    return {
      id: 'li-' + r.jobId, company: r.org, title: r.position, description: r.blurb,
      skills: r.skills, location: r.place, workMode: r.mode, employmentType: r.type,
      salary: r.payShown ? r.payMin : null, salaryMax: r.payShown ? r.payMax : null,
      currency: r.payCur || 'USD', salaryDisclosed: !!r.payShown, salaryPeriod: r.payPeriod || 'year',
      source: 'LinkedIn', applyUrl: r.url, postedDate: r.listedOn,
      visaSponsorship: !!r.sponsor, relocationSupport: !!r.reloAssist, companyLogo: null, languagesRequired: r.langs || [],
      originalSource: 'LinkedIn', sourceJobId: 'li-' + r.jobId, canonicalUrl: canon(r.url),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.listedOn, lastChecked: today(),
    };
  }

  function fromBayt(r) {
    return {
      id: 'bt-' + r.ref, company: r.employer, title: r.title, description: r.summary,
      skills: r.keywords, location: r.city, workMode: r.arrangement, employmentType: r.contract,
      salary: r.disclosed ? r.salaryFrom : null, salaryMax: r.disclosed ? r.salaryTo : null,
      currency: r.cur, salaryDisclosed: !!r.disclosed, salaryPeriod: r.per || 'year',
      source: 'Bayt', applyUrl: r.link, postedDate: r.date,
      visaSponsorship: !!r.visa, relocationSupport: !!r.relocationHelp, companyLogo: null, languagesRequired: r.languages || [],
      originalSource: 'Bayt', sourceJobId: r.ref, canonicalUrl: canon(r.link),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.date, lastChecked: today(),
    };
  }

  function fromGulfTalent(r) {
    return {
      id: 'gt-' + r.gtId, company: r.firm, title: r.role, description: r.about,
      skills: r.tags, location: r.location, workMode: r.workStyle, employmentType: r.engagement,
      salary: r.showPay ? r.payLow : (r.payText || null), salaryMax: r.showPay ? r.payHigh : null,
      currency: r.payCurrency, salaryDisclosed: !!r.showPay, salaryPeriod: r.payBasis || 'year',
      source: 'GulfTalent', applyUrl: r.href, postedDate: r.posted,
      visaSponsorship: !!r.sponsorship, relocationSupport: !!r.reloSupport, companyLogo: null, languagesRequired: r.langNeeds || [],
      originalSource: 'GulfTalent', sourceJobId: r.gtId, canonicalUrl: canon(r.href),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.posted, lastChecked: today(),
    };
  }

  function fromCareersPortal(r) {
    return {
      id: 'cc-' + r.reqId, company: r.companyName, title: r.roleTitle, description: r.desc,
      skills: r.stack, location: r.loc, workMode: r.modeOfWork, employmentType: r.engType,
      salary: r.compShown ? r.compMin : (r.compText || null), salaryMax: r.compShown ? (r.compMax || null) : null,
      currency: r.compCur, salaryDisclosed: !!r.compShown, salaryPeriod: r.compBasis || 'year',
      source: 'Company Careers', applyUrl: r.applyLink, postedDate: r.firstSeen,
      visaSponsorship: !!r.visaHelp, relocationSupport: !!r.relocationPkg, companyLogo: null, languagesRequired: r.languages || [],
      originalSource: 'Company Careers', sourceJobId: r.reqId, canonicalUrl: canon(r.applyLink),
      duplicateGroupId: null, duplicates: [], firstDiscovered: r.firstSeen, lastChecked: today(),
    };
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
      id: 'linkedin', label: 'LinkedIn Jobs',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'sessionRef'],
      demoFeed: () => LINKEDIN_RAW.map(fromLinkedIn),
    }),
    bayt: ConnectorBase.createAdapter({
      id: 'bayt', label: 'Bayt',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],
      demoFeed: () => BAYT_RAW.map(fromBayt),
    }),
    gulftalent: ConnectorBase.createAdapter({
      id: 'gulftalent', label: 'GulfTalent',
      capabilities: CAPABILITIES,
      requires: ['endpoint', 'apiKeyRef'],
      demoFeed: () => GULFTALENT_RAW.map(fromGulfTalent),
    }),
    careers: ConnectorBase.createAdapter({
      id: 'careers', label: 'Company Career Portals',
      capabilities: CAPABILITIES,
      requires: ['endpoint'],
      demoFeed: () => {
        const portals = enabledPortals();
        return CAREERS_RAW.filter(r => portals[r.portal]).map(fromCareersPortal);
      },
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

  return { get, all, isConfigured, fromLinkedIn, fromBayt, fromGulfTalent, fromCareersPortal };
})();
