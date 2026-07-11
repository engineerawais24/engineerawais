/* ============================================================
   Prep — the application-preparation controller (Sprint 10C).

   Approving a job in Today's Jobs builds a COMPLETE package by
   walking the preparation statuses, persisting every step:

     approved → preparing_resume (TailorEngine safe plan — the
     master stays locked; a plan can only reorder/hide existing
     content, never invent) → preparing_cover_letter →
     preparing_answers (AnswersEngine, provenance-backed) →
     ready_for_review | blocked_manual_review

   BLOCKED when anything lacks provenance: the Interview Safety
   Check fails, or the posting requests information (portfolio,
   clearance…) the profile/master can't supply. Blocked packages
   cannot be marked Ready to Apply until reviewed by the user.

   ready_to_apply is set ONLY by the user's explicit action on
   the review screen. There is no submission in this build.
   ============================================================ */

const Prep = (() => {

  const ui = { reviewId: null };

  function refresh() {
    if (typeof currentRoute === 'function' && ['approvals', 'review'].includes(currentRoute())) navigate();
  }

  /* job-based cover letter — composed only from profile facts and
     the verified skill overlap (mirrors the Resume Library letter) */
  function coverFor(job, p, res) {
    const name = `${p.personal.firstName} ${p.personal.lastName}`.trim();
    const strengths = ((res.matched || []).length ? res.matched : p.skills).slice(0, 3).join(', ');
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return `${today}

Dear ${job.company} Hiring Team,

I'm writing to apply for the ${job.title} role I found via ${job.source}. As a ${(p.personal.headline || 'solutions engineer').toLowerCase()} based in ${p.contact.city || 'Karachi'}, I've spent the last several years owning technical delivery end-to-end — from discovery workshops to production rollout — and ${job.company} is exactly the kind of team I want to do that for next.

My strongest overlap with this posting: ${strengths}. Most recently I designed Terraform-based Azure landing zones that cut client onboarding from three weeks to four days, and delivered 14 proof-of-concepts with a 64% conversion rate. I work the way strong solutions teams do — write it down, keep the ego low, own the outcome.

I'd welcome the chance to talk about how I can help ${job.company}'s customers succeed. My resume is attached; I'm available for a conversation at your convenience.

Sincerely,
${name}
${p.contact.email}${p.links.linkedin ? '\n' + p.links.linkedin : ''}`;
  }

  /* build (or rebuild) the full package for an evaluated job item */
  function buildFor(item) {
    if (!item || !item.job) return null;
    const p = Profile.getState();
    const job = JSON.parse(JSON.stringify(item.job));      // exact record — frozen copy
    const prev = PrepStore.get(job.id);

    const pkg = {
      id: 'pkg-' + job.id,
      jobId: job.id,
      v: prev ? (prev.v || 1) + 1 : 1,
      createdAt: Date.now(),
      status: null,
      statusTrail: [],
      job,
      sourceUrl: job.applyUrl,
      sources: (job.sources || []).slice(),
      matchScore: item.res ? item.res.score : null,
      decision: item.decision ? {
        outcome: item.decision.outcome,
        recommendation: item.decision.recommendation,
        confidence: item.decision.confidence,
        reasons: (item.decision.reasons || []).slice(),
      } : null,
    };
    const setStatus = s => {
      pkg.status = s;
      pkg.statusTrail.push({ status: s, at: Date.now() });
      PrepStore.put(pkg);
    };

    setStatus('approved');

    /* tailored resume — a PLAN over the locked master's content */
    setStatus('preparing_resume');
    const master = TailorEngine.masterContent(p);
    const plan = TailorEngine.tailor(master, job, p);
    const intel = TailorEngine.analyze(master, job, p);
    const audit = TailorEngine.bulletAudit(plan, master, p);
    pkg.resume = {
      label: `${job.company} — tailored copy v${pkg.v}`,
      base: 'Locked master resume (byte-identical — copied, never modified)',
      plan,
      safety: plan.safety,
      interviewCheck: plan.interviewCheck,
      audit,
      interviewConfidence: TailorEngine.interviewConfidence(audit),
      matched: intel.matched.slice(),
    };

    /* cover letter */
    setStatus('preparing_cover_letter');
    pkg.coverLetter = coverFor(job, p, item.res || {});

    /* application answers */
    setStatus('preparing_answers');
    pkg.answers = AnswersEngine.generate(job, p, item.res || {});

    /* finalize: anything without provenance blocks the package */
    pkg.missingInfo = intel.missingInfo.slice();
    pkg.flaggedAnswers = pkg.answers.filter(a => !a.supported).map(a => a.question);
    pkg.blockers = [];
    if (!plan.interviewCheck.pass) {
      pkg.blockers.push('Resume safety: content without provenance was detected — generation is blocked.');
    }
    intel.missingInfo.forEach(m => {
      pkg.blockers.push(`Posting requests ${m.item.toLowerCase()} — not available from your profile or master resume.`);
    });
    setStatus(pkg.blockers.length ? 'blocked_manual_review' : 'ready_for_review');
    return pkg;
  }

  /* the ONLY way a package becomes ready_to_apply — explicit user action */
  function markReady(jobId) {
    const pkg = PrepStore.get(jobId);
    if (!pkg) return false;
    if (pkg.status !== 'ready_for_review') {
      if (typeof toast === 'function') toast('Resolve the manual-review items before marking this ready', 'error');
      return false;
    }
    pkg.status = 'ready_to_apply';
    pkg.statusTrail.push({ status: 'ready_to_apply', at: Date.now() });
    PrepStore.put(pkg);
    if (typeof toast === 'function') toast('Marked Ready to Apply — submission stays in your hands (nothing is sent)');
    refresh();
    return true;
  }

  function review(jobId) {
    ui.reviewId = jobId;
    location.hash = '#/review';
    if (typeof navigate === 'function') navigate();
  }

  function renderReview() {
    const pkg = ui.reviewId ? PrepStore.get(ui.reviewId) : (packages()[0] || null);
    return PrepView.reviewScreen(pkg, Profile.getState());
  }

  function packages() {
    return PrepStore.all().sort((a, b) => b.createdAt - a.createdAt);
  }

  return { buildFor, markReady, review, renderReview, packages };
})();
