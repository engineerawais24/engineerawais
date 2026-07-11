/* ============================================================
   Submitters — the SUBMISSION adapter registry (Sprint 12).

   One production-ready (mock) submitter per supported destination.
   `method` records how a real submission would happen so the UI
   and a future backend can branch on it; capabilities record what
   each board can accept. Everything is created through
   SubmissionBase.createSubmitter — no live login, no live send.

     easy_apply     LinkedIn's in-network apply flow
     ats_api        public/tokened ATS APIs (Greenhouse, Lever,
                    SmartRecruiters application endpoints)
     ats_form       tenant-hosted ATS forms (Bayt, GulfTalent,
                    Workday CXS)
     external_form  the employer's own careers form

   forJob(job) resolves the submitter from the job's `source`
   label (the JobSchema provider label), falling back to the
   generic company-careers submitter so every job is submittable.
   ============================================================ */

const Submitters = (() => {

  const REGISTRY = {
    linkedin: SubmissionBase.createSubmitter({
      id: 'linkedin', label: 'LinkedIn Easy Apply', method: 'easy_apply',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['sessionRef'],
    }),
    bayt: SubmissionBase.createSubmitter({
      id: 'bayt', label: 'Bayt', method: 'ats_form',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint', 'apiKeyRef'],
    }),
    gulftalent: SubmissionBase.createSubmitter({
      id: 'gulftalent', label: 'GulfTalent', method: 'ats_form',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint', 'apiKeyRef'],
    }),
    greenhouse: SubmissionBase.createSubmitter({
      id: 'greenhouse', label: 'Greenhouse', method: 'ats_api',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint'],
    }),
    lever: SubmissionBase.createSubmitter({
      id: 'lever', label: 'Lever', method: 'ats_api',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint'],
    }),
    workday: SubmissionBase.createSubmitter({
      id: 'workday', label: 'Workday', method: 'ats_form',
      capabilities: { resume: true, coverLetter: false, answers: true },
      requires: ['endpoint', 'apiKeyRef'],
    }),
    smartrecruiters: SubmissionBase.createSubmitter({
      id: 'smartrecruiters', label: 'SmartRecruiters', method: 'ats_api',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint', 'apiKeyRef'],
    }),
    careers: SubmissionBase.createSubmitter({
      id: 'careers', label: 'Company Careers', method: 'external_form',
      capabilities: { resume: true, coverLetter: true, answers: true },
      requires: ['endpoint'],
    }),
  };

  /* JobSchema provider label → submitter id */
  const SOURCE_MAP = {
    'LinkedIn': 'linkedin',
    'Bayt': 'bayt',
    'GulfTalent': 'gulftalent',
    'Greenhouse': 'greenhouse',
    'Lever': 'lever',
    'Workday': 'workday',
    'SmartRecruiters': 'smartrecruiters',
    'Company Careers': 'careers',
    'Company Career Portals': 'careers',
  };

  function get(id) { return REGISTRY[id] || null; }
  function all() { return Object.values(REGISTRY); }
  function ids() { return Object.keys(REGISTRY); }

  function forJob(job) {
    const src = job && job.source;
    const id = (src && SOURCE_MAP[src]) || 'careers';
    return REGISTRY[id] || REGISTRY.careers;
  }

  return { get, all, ids, forJob, SOURCE_MAP };
})();
