/* ============================================================
   JobsStore â€” the unified Job model + sourced jobs (Sprint 8A).

   UNIFIED JOB MODEL â€” every sourced job, regardless of board,
   is normalized into this shape. The backend crawlers (LinkedIn,
   Bayt, GulfTalent, company career pages) emit exactly this:

   {
     id:              string          â€” stable id for decisions/sync
     company:         string
     title:           string
     description:     string          â€” short summary of the posting
     skills:          string[]        â€” required skills/keywords
     location:        string          â€” 'Dubai Â· Hybrid', 'Remote Â· US'â€¦
     workMode:        'Remote' | 'Hybrid' | 'On-site'
     employmentType:  'Full-time' | 'Contract' | 'Part-time'
     salary:          number|string|null â€” annual, thousands of `currency`
                                          (number), or text like
                                          'Competitive'/'Negotiable'/'DOE',
                                          or null when unknown
     salaryMax:       number|null     â€” top of a disclosed range
     currency:        'USD'|'AED'|'SAR'|'PKR'|'GBP'|'EUR'
     salaryDisclosed: boolean         â€” false â†’ NEVER filtered on salary
     source:          'LinkedIn'|'Bayt'|'GulfTalent'|'Company Careers'
     applyUrl:        string          â€” original posting URL
     postedDate:      'YYYY-MM-DD'
     visaSponsorship: boolean
     relocationSupport: boolean       â€” employer explicitly offers
                                        relocation assistance (GCC-first
                                        regional work-mode rules)
     companyLogo:     string|null     â€” logo URL once the backend serves
                                        them; UI falls back to a monogram
     languagesRequired: string[]      â€” languages named by the posting
     salaryPeriod:    'year'|'month'  â€” yearly figures are in thousands;
                                        monthly figures are absolute
                                        (e.g. SAR 38,000/month)

     â€” source & duplicate metadata (Sprint 8B) â€”
     originalSource:  string          â€” board this record came from
     sourceJobId:     string          â€” the board's own posting id
     canonicalUrl:    string          â€” applyUrl stripped of tracking
     duplicateGroupId: string|null    â€” shared id across duplicates
     duplicates:      string[]        â€” other boards this job was seen on
     firstDiscovered: 'YYYY-MM-DD'
     lastChecked:     'YYYY-MM-DD'
   }

   Decisions (approve / reject / later) persist per job id, and a
   daily-search run persists its normalized result as `discovered`
   (until then SAMPLE_JOBS stands in for the crawlers).
   ============================================================ */

const JobsStore = (() => {

  const KEY = 'careerpilot_jobs_v1';

  const SOURCES = ['LinkedIn', 'Bayt', 'GulfTalent', 'Company Careers'];

  const SRC_PREFIX = { 'LinkedIn': 'li', 'Bayt': 'bt', 'GulfTalent': 'gt', 'Company Careers': 'cc' };

  /* fill in derivable metadata so every job satisfies the full model */
  function enrich(j) {
    return Object.assign({
      salaryPeriod: 'year',
      relocationSupport: false,
      originalSource: j.source,
      sourceJobId: (SRC_PREFIX[j.source] || 'xx') + '-' + j.id.replace('job', '9'),
      canonicalUrl: (j.applyUrl || '').split(/[?#]/)[0],
      duplicateGroupId: null,
      duplicates: [],
      firstDiscovered: j.postedDate,
      lastChecked: '2026-07-10',
    }, j);
  }

  /* Emptied 2026-08-03 — no demo jobs. Today's Jobs starts empty and is
     filled only by real postings: the extension's LinkedIn import, saved
     jobs, manual imports, or a search you run yourself. */
  const BASE_JOBS = [];

  const SAMPLE_JOBS = BASE_JOBS.map(enrich);

  function jobs() {
    return SAMPLE_JOBS;
  }

  /* ---------- persisted decisions + discovered jobs ---------- */

  function load() {
    const base = { decisions: {}, discovered: null };
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (saved && typeof saved.decisions === 'object') base.decisions = saved.decisions;
      if (Array.isArray(saved.discovered) && saved.discovered.length) base.discovered = saved.discovered;
    } catch (e) { /* fall through to defaults */ }
    return base;
  }

  /* persist the normalized result of a daily-search run */
  function setDiscovered(list) {
    const state = load();
    state.discovered = Array.isArray(list) && list.length ? list : null;
    save(state);
    return state;
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

  return { KEY, SOURCES, jobs, load, save, clear, setDiscovered, enrich };
})();
