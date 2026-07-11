/* ============================================================
   JobSchema — the NORMALIZED JOB contract (Sprint 10A).

   Every connector — regardless of provider — must emit records
   in exactly this shape. This is the seam where real APIs plug
   in later: a live backend response is passed through
   JobSchema.normalized() + JobSchema.validate() and the rest of
   the pipeline (dedupe → GCC → salary → ranking → match →
   decision) never knows or cares which provider it came from.

   REQUIRED NORMALIZED FIELDS (Sprint 10A contract):
     title            string
     company          string
     location         string            'Dubai · Hybrid', 'Remote · US'…
     workMode         remote type       'Remote' | 'Hybrid' | 'On-site'
     salary           number|string|null (annual = thousands of currency,
                                         monthly = absolute; text like
                                         'Competitive' allowed; null unknown)
     salaryDisclosed  boolean           false → NEVER filtered on salary
     visaSponsorship  boolean
     description      string
     skills           string[]          required skills
     preferredSkills  string[]          nice-to-have skills (10A)
     applyUrl         string
     source           string            provider label
     sourceJobId      posting ID        the provider's own id
     postedDate       'YYYY-MM-DD'
     companyCareerPage string|null      employer careers URL (10A)
     employmentType   string            'Full-time' | 'Contract' | …

   Companion fields (kept from the Sprint 8A unified model so all
   existing engines run unchanged): id, salaryMax, currency,
   salaryPeriod, relocationSupport, companyLogo, languagesRequired,
   originalSource, canonicalUrl, duplicateGroupId, duplicates,
   firstDiscovered, lastChecked.

   Sprint 10B adds `sources` — one provenance entry per copy of
   the job seen across boards ({source, applyUrl, sourceJobId,
   company, postedDate}), filled in by the pipeline merge so no
   board's URL or posting id is ever lost to deduplication.
   ============================================================ */

const JobSchema = (() => {

  const WORK_MODES = ['Remote', 'Hybrid', 'On-site'];

  /* the Sprint 10A normalized contract — used by validate() and tests */
  const REQUIRED_FIELDS = [
    'title', 'company', 'location', 'workMode',
    'salary', 'salaryDisclosed', 'visaSponsorship', 'description',
    'skills', 'preferredSkills', 'applyUrl', 'source',
    'sourceJobId', 'postedDate', 'companyCareerPage', 'employmentType',
  ];

  const today = () => new Date().toISOString().slice(0, 10);
  const canon = url => String(url || '').split(/[?#]/)[0];
  const arr = v => Array.isArray(v) ? v.slice() : [];

  /* prefix registry for stable ids — one per supported source */
  const SRC_PREFIX = {
    'LinkedIn': 'li', 'Bayt': 'bt', 'GulfTalent': 'gt', 'Company Careers': 'cc',
    'Greenhouse': 'gh', 'Lever': 'lv', 'Workday': 'wd', 'SmartRecruiters': 'sr',
  };

  /* ---------- normalization: partial record → full contract ---------- */

  function normalized(rec) {
    const r = rec || {};
    const source = String(r.source || 'Unknown');
    const sourceJobId = String(r.sourceJobId || r.id || '');
    const posted = r.postedDate || today();
    const j = {
      /* identity */
      id: r.id || ((SRC_PREFIX[source] || 'xx') + '-' + sourceJobId),
      /* the 16-field contract */
      title: String(r.title || ''),
      company: String(r.company || ''),
      location: String(r.location || ''),
      workMode: WORK_MODES.includes(r.workMode) ? r.workMode : 'On-site',
      salary: r.salary !== undefined ? r.salary : null,
      salaryDisclosed: !!r.salaryDisclosed,
      visaSponsorship: !!r.visaSponsorship,
      description: String(r.description || ''),
      skills: arr(r.skills),
      preferredSkills: arr(r.preferredSkills),
      applyUrl: String(r.applyUrl || ''),
      source,
      sourceJobId,
      postedDate: posted,
      companyCareerPage: r.companyCareerPage || null,
      employmentType: String(r.employmentType || 'Full-time'),
      /* companions the engines already consume */
      salaryMax: r.salaryMax !== undefined ? r.salaryMax : null,
      currency: r.currency || 'USD',
      salaryPeriod: r.salaryPeriod === 'month' ? 'month' : 'year',
      relocationSupport: !!r.relocationSupport,
      companyLogo: r.companyLogo || null,
      languagesRequired: arr(r.languagesRequired),
      /* source & duplicate metadata */
      originalSource: r.originalSource || source,
      canonicalUrl: r.canonicalUrl || canon(r.applyUrl),
      duplicateGroupId: r.duplicateGroupId || null,
      duplicates: arr(r.duplicates),
      sources: arr(r.sources),
      firstDiscovered: r.firstDiscovered || posted,
      lastChecked: r.lastChecked || today(),
    };
    /* rule: an undisclosed salary is never a number the filters
       could act on — keep any provider text, drop stray numbers */
    if (!j.salaryDisclosed && typeof j.salary === 'number') j.salary = null;
    if (!j.salaryDisclosed) j.salaryMax = null;
    return j;
  }

  /* ---------- validation: list of problems, never throws ---------- */

  function validate(job) {
    const problems = [];
    if (!job || typeof job !== 'object') return ['record is not an object'];
    REQUIRED_FIELDS.forEach(f => {
      if (!(f in job)) problems.push(`missing field: ${f}`);
    });
    if (!String(job.title || '').trim()) problems.push('title is empty');
    if (!String(job.company || '').trim()) problems.push('company is empty');
    if (!String(job.sourceJobId || '').trim()) problems.push('sourceJobId is empty');
    if (job.workMode && !WORK_MODES.includes(job.workMode)) problems.push(`invalid workMode: ${job.workMode}`);
    if (!Array.isArray(job.skills)) problems.push('skills is not an array');
    if (!Array.isArray(job.preferredSkills)) problems.push('preferredSkills is not an array');
    if (typeof job.salaryDisclosed !== 'boolean') problems.push('salaryDisclosed is not boolean');
    if (job.postedDate && !/^\d{4}-\d{2}-\d{2}$/.test(job.postedDate)) problems.push('postedDate is not YYYY-MM-DD');
    return problems;
  }

  /* a record is publishable when identity + provenance are sound */
  function isValid(job) {
    return validate(job).length === 0;
  }

  return { REQUIRED_FIELDS, WORK_MODES, SRC_PREFIX, normalized, validate, isValid };
})();
