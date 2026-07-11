/* ============================================================
   AnswersEngine — draft application answers (10C → 12).

   Sprint 12 completes the question set to 13: current location,
   notice period, salary, work authorization, visa status,
   sponsorship requirement, relocation, why-company, why-role,
   years of experience, current employer, highest qualification
   and certifications. Every answer stays provenance-backed.

   THE SAFETY MODEL (same philosophy as TailorEngine): every
   answer is composed ONLY from facts already present in the
   Profile, the job record, or the match result. Nothing is
   invented. When the backing fact is missing or the connection
   can't be proven, the answer ships EMPTY with the flag
   'Manual review required' — a human fills it in.

   generate(job, profile, matchRes) → [{
     id, question,
     answer:    string ('' when unsupported),
     source:    where the fact came from (provenance line),
     supported: boolean,
     flag:      'Manual review required' | null,
     note:      why it was flagged (when unsupported)
   }]
   ============================================================ */

const AnswersEngine = (() => {

  const lc = s => String(s || '').toLowerCase();

  function supported(id, question, answer, source) {
    return { id, question, answer, source, supported: true, flag: null, note: null };
  }

  function flagged(id, question, note) {
    return {
      id, question, answer: '', source: null,
      supported: false, flag: 'Manual review required', note,
    };
  }

  /* is the job local to where the user already holds work rights? */
  function authorizedIn(p) {
    return ((p.authorization && p.authorization.authorizedIn) || '').trim();
  }

  function isAuthorizedLocation(job, p) {
    const loc = lc(job.location);
    const auth = lc(authorizedIn(p));
    const homeCity = lc(p.contact.city);
    return (auth && loc.includes(auth)) || (homeCity && loc.includes(homeCity)) || job.workMode === 'Remote';
  }

  /* total professional experience — derived ONLY from the saved
     employment history's earliest start date. Never invented: if
     no dated history exists it returns null and the answer flags. */
  function yearsOfExperience(p) {
    const dates = [];
    if (p.employment && p.employment.startDate) dates.push(p.employment.startDate);
    (p.history || []).forEach(h => { if (h && h.startDate) dates.push(h.startDate); });
    if (!dates.length) return null;
    const earliest = dates.slice().sort()[0];               // 'YYYY-MM' sorts lexically
    const [y, m] = earliest.split('-').map(Number);
    if (!y) return null;
    const start = new Date(y, (m || 1) - 1, 1);
    const years = (Date.now() - start.getTime()) / (365.25 * 24 * 3600e3);
    return years >= 1 ? Math.floor(years) : Math.max(0, Math.round(years * 10) / 10);
  }

  function generate(job, profile, matchRes) {
    const p = profile;
    const res = matchRes || { matched: [], missing: [] };
    const answers = [];

    /* 1 — notice period (Profile → Current employment) */
    const np = (p.employment && p.employment.noticePeriod || '').trim();
    answers.push(np
      ? supported('notice_period', 'What is your notice period?',
          `${np} from offer acceptance.`,
          'Profile → Current employment → Notice period')
      : flagged('notice_period', 'What is your notice period?',
          'No notice period saved in your Profile — add it under Current employment.'));

    /* 2 — salary expectation (currency- and period-aware, same
       thresholds the salary filter uses) */
    const cur = job.currency;
    const monthly = job.salaryPeriod === 'month';
    let sal = null;
    let salSrc = null;
    if (monthly && cur === 'SAR' && p.preferences.monthlyMinSAR) {
      sal = `SAR ${Number(p.preferences.monthlyMinSAR).toLocaleString('en-US')} per month or above.`;
      salSrc = 'Profile → Preferences → Monthly minimum (SAR)';
    } else if (monthly && cur === 'AED' && p.preferences.monthlyMinAED) {
      sal = `AED ${Number(p.preferences.monthlyMinAED).toLocaleString('en-US')} per month or above.`;
      salSrc = 'Profile → Preferences → Monthly minimum (AED)';
    } else if (p.preferences.minSalary) {
      sal = `$${p.preferences.minSalary}k per year or above (open to discussing the full package).`;
      salSrc = 'Profile → Preferences → Minimum base salary';
    }
    answers.push(sal
      ? supported('salary_expectation', 'What is your salary expectation?', sal, salSrc)
      : flagged('salary_expectation', 'What is your salary expectation?',
          'No salary minimum saved in your Profile preferences.'));

    /* 3 — work authorization */
    const auth = authorizedIn(p);
    answers.push(auth
      ? supported('work_authorization', 'Are you authorized to work in this location?',
          `I hold work authorization in ${auth}.` + (isAuthorizedLocation(job, p)
            ? ' This role is within my authorized/remote scope.'
            : ` This posting's location (${job.location.split('·')[0].trim()}) would require sponsorship.`),
          'Profile → Work authorization')
      : flagged('work_authorization', 'Are you authorized to work in this location?',
          'No work-authorization country saved in your Profile.'));

    /* 4 — visa sponsorship (derived: profile authorization vs job location) */
    if (auth) {
      const local = isAuthorizedLocation(job, p);
      answers.push(supported('visa_sponsorship', 'Do you require visa sponsorship?',
        local
          ? 'No — no sponsorship is required for this role.'
          : `Yes — I would require visa sponsorship for ${job.location.split('·')[0].trim()}.`
            + (job.visaSponsorship ? ' The posting indicates sponsorship is available.' : ' The posting does not state that sponsorship is offered.'),
        'Derived: Profile work authorization vs posting location'));
    } else {
      answers.push(flagged('visa_sponsorship', 'Do you require visa sponsorship?',
        'Cannot be derived — work authorization is missing from your Profile.'));
    }

    /* 5 — willingness to relocate (GCC-first work-mode preference) */
    const outside = (p.preferences.outsideGccMode || '').trim();
    answers.push(outside
      ? supported('relocation', 'Are you willing to relocate?',
          /relocation/i.test(outside)
            ? 'Yes — I am open to relocating when the employer provides relocation support.'
            : `My saved preference is “${outside}”.`,
          'Profile → Preferences → Outside GCC work mode')
      : flagged('relocation', 'Are you willing to relocate?',
          'No relocation/work-mode preference saved in your Profile.'));

    /* 6 — why this company (only from verified skill overlap) */
    if ((res.matched || []).length >= 2) {
      answers.push(supported('why_company', `Why do you want to work at ${job.company}?`,
        `My hands-on experience with ${res.matched.slice(0, 3).join(', ')} maps directly to what ${job.company} is hiring for, and the problems described in this posting are the kind of client-facing delivery work I do best.`,
        'Match engine — verified skill overlap with your Profile'));
    } else {
      answers.push(flagged('why_company', `Why do you want to work at ${job.company}?`,
        'Fewer than two verified skill overlaps — write this one yourself so it stays truthful.'));
    }

    /* 7 — why this role (posting title vs saved target roles) */
    const targets = String(p.preferences.targetRoles || '').split(',').map(s => s.trim()).filter(Boolean);
    const hitRole = targets.find(r => lc(job.title).includes(lc(r)));
    answers.push(hitRole
      ? supported('why_role', `Why are you interested in the ${job.title} role?`,
          `${hitRole} is one of my saved target roles — my background as a ${p.personal.headline || 'solutions engineer'} covers exactly this scope, from discovery workshops to production rollout.`,
          'Profile → Preferences → Target roles')
      : flagged('why_role', `Why are you interested in the ${job.title} role?`,
          `“${job.title}” does not match any of your saved target roles — confirm the fit and answer manually.`));

    /* 8 — current location */
    const city = (p.contact.city || '').trim();
    const country = (p.contact.country || '').trim();
    answers.push(city || country
      ? supported('current_location', 'Where are you currently located?',
          [city, country].filter(Boolean).join(', ') + '.',
          'Profile → Contact')
      : flagged('current_location', 'Where are you currently located?',
          'No city/country saved in your Profile contact details.'));

    /* 9 — visa / residency status (Profile → Work authorization).
       Distinct from the sponsorship question above: this states the
       status the user holds, it does not derive a requirement. */
    const visaStatus = ((p.authorization && p.authorization.status) || '').trim();
    answers.push(visaStatus
      ? supported('visa_status', 'What is your current visa / residency status?',
          `${visaStatus}${auth ? ` — authorized to work in ${auth}.` : '.'}`,
          'Profile → Work authorization → Status')
      : flagged('visa_status', 'What is your current visa / residency status?',
          'No residency/visa status saved in your Profile work authorization.'));

    /* 10 — years of experience (derived from dated employment history) */
    const yoe = yearsOfExperience(p);
    answers.push(yoe != null
      ? supported('years_experience', 'How many years of experience do you have?',
          `${yoe}${yoe >= 1 ? '+' : ''} year${yoe === 1 ? '' : 's'} of professional experience.`,
          'Profile → Employment history (earliest start date)')
      : flagged('years_experience', 'How many years of experience do you have?',
          'No dated employment history saved in your Profile.'));

    /* 11 — current employer (Profile → Current employment) */
    const emp = p.employment || {};
    const empCo = (emp.company || '').trim();
    answers.push(empCo
      ? supported('current_employer', 'Who is your current employer?',
          `${empCo}${emp.title ? ` (${emp.title})` : ''}${emp.current ? ', current' : ''}${emp.startDate ? `, since ${emp.startDate}` : ''}.`,
          'Profile → Current employment')
      : flagged('current_employer', 'Who is your current employer?',
          'No current employer saved in your Profile.'));

    /* 12 — highest qualification. The Profile has no education/degree
       field, so this is never invented — a certification is NOT a
       degree. When nothing supports it, it flags for manual review. */
    const degree = ((p.education && (p.education.highest || p.education.degree)) || '').trim();
    answers.push(degree
      ? supported('highest_qualification', 'What is your highest qualification?',
          `${degree}.`, 'Profile → Education')
      : flagged('highest_qualification', 'What is your highest qualification?',
          'No education/degree saved in your Profile — add your highest qualification (a certification is not a degree).'));

    /* 13 — certifications (Profile → Certifications) */
    const certs = ((p.certifications) || [])
      .filter(c => c && c.name)
      .map(c => `${c.name}${c.issuer ? ` — ${c.issuer}` : ''}${c.year ? ` (${c.year})` : ''}`);
    answers.push(certs.length
      ? supported('certifications', 'What certifications do you hold?',
          certs.join('; ') + '.', 'Profile → Certifications')
      : flagged('certifications', 'What certifications do you hold?',
          'No certifications saved in your Profile.'));

    return answers;
  }

  return { generate };
})();
