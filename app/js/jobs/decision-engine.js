/* ============================================================
   DecisionEngine — intelligent job decisions (Sprint 9B).

   Pure: decide(job, matchResult, rankResult, snapshot) →

     {
       outcome:        'auto_approve' | 'manual_review' | 'reject',
       outcomeLabel,
       recommendation: 'Must Apply' | 'Strong Match' | 'Good Match'
                       | 'Review Manually' | 'Skip',
       confidence:     'High' | 'Medium' | 'Low',
       score:          decision score (rank score ± decision bumps),
       reasons:        [{ ok: bool, text }]   — the ✓/✗ explanation
     }

   Hard rules:
   · missing/undisclosed salary NEVER causes rejection
   · disclosed salary below minimum → reject; at/above → accept signal
   · GCC roles eligible in every work mode; outside GCC, remote is
     always eligible, on-site/hybrid only with sponsorship/relocation
   · wrong seniority (junior / internship / entry-level) → reject
   · low score alone never rejects — it goes to manual review

   "Auto Approve" is a RECOMMENDATION: the application still only
   ever moves via explicit user approval, and the locked master
   resume is read-only input throughout.
   ============================================================ */

const DecisionEngine = (() => {

  const OUTCOMES = { APPROVE: 'auto_approve', REVIEW: 'manual_review', REJECT: 'reject' };
  const OUTCOME_LABELS = {
    auto_approve: 'Auto Approve',
    manual_review: 'Manual Review',
    reject: 'Reject',
  };

  const SENIORITY = /junior|\bjr\.?\b|intern(ship)?\b|entry[-\s]?level|graduate\b|trainee/i;

  function decide(job, res, rank, snap) {
    const reasons = [];
    const yes = t => reasons.push({ ok: true, text: t });
    const no = t => reasons.push({ ok: false, text: t });
    let score = rank ? rank.rankScore : res.score;
    let reject = false;

    /* ---- region eligibility (GCC-first rules) ---- */
    if (res.region) {
      if (res.region.gcc) {
        yes('GCC role — on-site, hybrid and remote all eligible');
      } else if (res.filterReason === 'region') {
        reject = true;
        no('Outside GCC on-site/hybrid without visa sponsorship or relocation support');
      } else if (res.region.includeReason === 'Remote') {
        yes('Remote role — eligible from anywhere');
      } else if (res.region.includeReason === 'Visa sponsorship') {
        yes('Visa sponsorship offered');
      } else if (res.region.includeReason === 'Relocation support') {
        yes('Relocation support offered');
      } else if (res.region.includeReason) {
        yes(res.region.includeReason);
      }
    }

    /* ---- salary rules (missing salary NEVER rejects) ---- */
    const k = MatchEngine.usdK(job);
    const monthlyThr = job.salaryPeriod === 'month' ? (snap.monthlyMin[job.currency] || 0) : 0;
    if (!job.salaryDisclosed || k === null) {
      yes('Salary not disclosed — never auto-rejected');
    } else if (monthlyThr) {
      const v = job.salaryMax != null ? job.salaryMax : job.salary;
      if (v < monthlyThr) {
        reject = true;
        no(`Salary below your ${job.currency} ${Number(monthlyThr).toLocaleString('en-US')}/mo minimum`);
      } else {
        yes('Salary meets your monthly minimum');
        if (v >= monthlyThr * 1.2) { score += 4; yes('Salary well above target'); }
      }
    } else if (k < snap.minSalaryK) {
      reject = true;
      no(`Salary below your $${snap.minSalaryK}k minimum`);
    } else {
      yes(`Salary meets your $${snap.minSalaryK}k minimum`);
      if (k >= snap.minSalaryK * 1.2) { score += 4; yes('Salary well above target'); }
    }

    /* ---- seniority (wrong level → reject, per policy) ---- */
    if (SENIORITY.test(job.title || '')) {
      reject = true;
      if (/intern/i.test(job.title)) no('Internship');
      if (/entry[-\s]?level|graduate|trainee/i.test(job.title)) no('Entry level');
      if (/junior|\bjr\.?\b/i.test(job.title)) no('Junior seniority — below your level');
    }

    /* ---- boosts reflected as reasons ---- */
    if (rank && rank.tier === 1) yes('Tier 1 company');
    else if (rank && rank.tier === 2) yes('Tier 2 company');

    const roleF = res.factors.find(f => f.label === 'Role fit');
    if (roleF && roleF.points >= roleF.max * 0.6) yes('Target role match');

    const total = (job.skills || []).length;
    if (total) {
      const m = res.matched.length;
      if (m / total >= 0.5) {
        yes(`Skills match — ${m} of ${total} on your profile`);
      } else if (m === 0) {
        score -= 8;
        no(`Missing core skills — 0 of ${total} matched`);
      } else if (m / total < 0.25) {
        score -= 5;
        no(`Weak skills match — ${m} of ${total}`);
      }
    }

    if (job.postedDate && (Date.now() - new Date(job.postedDate + 'T00:00:00')) <= 3 * 864e5) {
      score += 3;
      yes('Posted in the last 3 days');
    }

    /* ---- penalties ---- */
    const authF = res.factors.find(f => f.label === 'Authorization & visa');
    if (authF && authF.gap) {
      score -= 6;
      no('Work authorization mismatch — you need sponsorship this employer doesn\'t offer');
    }
    if (snap.jobType === 'Full-time' && job.employmentType === 'Contract') {
      score -= 6;
      no('Contract role — your preference is Full-time');
    }

    score = Math.round(score);

    /* ---- outcome: rejection is cause-based only ---- */
    const outcome = reject ? OUTCOMES.REJECT : (score >= 85 ? OUTCOMES.APPROVE : OUTCOMES.REVIEW);

    /* ---- confidence ---- */
    const unknowns = (!job.salaryDisclosed ? 1 : 0) + (total === 0 ? 1 : 0);
    let confidence;
    if (reject) {
      confidence = (res.filterReason === 'region' && !job.salaryDisclosed) ? 'Medium' : 'High';
    } else if (unknowns === 0 && (score >= 80 || score < 45)) {
      confidence = 'High';
    } else if (unknowns >= 1 && score < 70) {
      confidence = 'Low';
    } else {
      confidence = 'Medium';
    }

    /* ---- recommendation badge ---- */
    let recommendation;
    if (reject) recommendation = 'Skip';
    else if (outcome === OUTCOMES.APPROVE) recommendation = score >= 92 ? 'Must Apply' : 'Strong Match';
    else recommendation = score >= 70 ? 'Good Match' : 'Review Manually';

    return {
      outcome,
      outcomeLabel: OUTCOME_LABELS[outcome],
      recommendation,
      confidence,
      score,
      reasons,
    };
  }

  return { decide, OUTCOMES, OUTCOME_LABELS };
})();
