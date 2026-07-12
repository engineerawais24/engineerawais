/* ============================================================
   PackageBuilder — the tailoring preview, the job summary, the
   application checklist and the copyable summary (Sprint 27).

   Everything here is DERIVED. It reads the profile, the Résumé
   Library, the job and the application package, and returns text.
   It never writes a résumé and never modifies the master — the
   preview is a set of SUGGESTIONS the user applies by hand.

   No AI, no network, no external service. Deterministic templating
   over data the app already holds:

     • the tailoring preview reuses TailorEngine.analyze (Sprint 10),
       which by design only ever suggests promoting, moving or
       highlighting content that is ALREADY on the master résumé.
     • the résumé and its confidence come from ResumeRecommender.
     • the cover letter comes from CoverLetter (Sprint 22).
   ============================================================ */

const PackageBuilder = (() => {

  const CHECKLIST = [
    { id: 'resume', label: 'Resume selected' },
    { id: 'cover', label: 'Cover letter ready' },
    { id: 'reviewed', label: 'Job reviewed' },
    { id: 'link', label: 'Application link verified' },
    { id: 'ready', label: 'Ready to Apply' },
  ];

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* ---------- job summary ---------- */

  function jobSummary(job) {
    if (!job) return '';
    const bits = [
      job.title && job.company ? `${job.title} at ${job.company}` : (job.title || job.company || ''),
      job.location || '',
      job.workMode || '',
      job.employmentType || '',
    ].filter(Boolean);
    const salary = (job.salaryDisclosed && job.salary != null)
      ? `${job.currency || 'USD'} ${job.salary}k${job.salaryMax ? `–${job.salaryMax}k` : ''}${job.salaryPeriod === 'month' ? '/month' : ''}`
      : 'Salary not disclosed';
    const skills = (job.skills || []).length ? `Asks for ${job.skills.slice(0, 6).join(', ')}.` : '';
    return `${bits.join(' · ')} · ${salary}. ${skills}`.trim();
  }

  /* ---------- tailoring preview (suggestions only) ---------- */

  /* The résumé the preview is written against: the one selected for this job. */
  function resumeFor(job) {
    if (typeof ResumeRecommender === 'undefined') return null;
    const r = ResumeRecommender.forJob(job);
    return r ? r.selected : null;
  }

  /* keywords worth carrying into the résumé: what the posting asks for that
     the selected résumé's role family does not already lead with */
  function suggestedKeywords(job, resume) {
    const asked = job.skills || [];
    if (!asked.length) return [];
    const leading = (typeof ResumeRecommender !== 'undefined' && resume)
      ? ResumeRecommender.keywordsFor(resume.isMaster ? resume.title : resume.title)
      : [];
    const hasIt = s => leading.some(k => {
      const a = lc(k), b = lc(s);
      return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
    });
    return asked.filter(s => !hasIt(s));
  }

  /* matched / missing / keywords / improvements — nothing is written anywhere */
  function tailoringPreview(job, profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p || typeof TailorEngine === 'undefined') {
      return { matchedSkills: [], missingSkills: [], suggestedKeywords: [], improvements: [], missingInfo: [], resume: null };
    }
    const resume = resumeFor(job);
    const master = TailorEngine.masterContent(p);
    const analysis = TailorEngine.analyze(master, job, p);

    /* the résumé-specific suggestion, on top of TailorEngine's generic tips */
    const improvements = analysis.tips.slice();
    if (resume && !resume.isMaster) {
      improvements.unshift(`Send the ${resume.name} résumé — it is the closest fit to this posting.`);
    }
    const certs = (typeof ResumeRecommender !== 'undefined')
      ? ResumeRecommender.certificationsRequiredBy(job) : [];
    const held = (typeof ResumeRecommender !== 'undefined')
      ? ResumeRecommender.certificationsHeld(p) : [];
    certs.forEach(c => {
      const have = held.some(h => lc(h).indexOf(lc(c)) !== -1 || lc(c).indexOf(lc(h)) !== -1);
      if (have) improvements.push(`Put ${c} near the top — this posting asks for it.`);
    });

    return {
      resume,
      matchedSkills: analysis.matched,
      missingSkills: analysis.missing,
      suggestedKeywords: suggestedKeywords(job, resume),
      improvements: improvements.slice(0, 6),
      /* things the posting wants that the master résumé cannot prove —
         surfaced, never invented */
      missingInfo: analysis.missingInfo,
    };
  }

  /* ---------- the checklist ---------- */

  function isVerifiableLink(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      const parsed = new URL(u);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && !!parsed.hostname && parsed.hostname.indexOf('.') !== -1;
    } catch (e) {
      return false;
    }
  }

  /* Every item is DERIVED from the package — the progress moves on its own as
     the user works, with nothing to tick by hand. */
  function checklist(pkg) {
    if (!pkg) return { items: [], done: 0, total: CHECKLIST.length, progress: 0, complete: false };

    const done = {
      resume: !!pkg.resumeId,
      cover: !!(pkg.coverLetter && pkg.coverLetter.trim().length > 40),
      reviewed: !!pkg.reviewedAt,
      link: isVerifiableLink(pkg.job && pkg.job.applyUrl),
    };
    /* "Ready to Apply" is the roll-up: everything above is done and the
       package is still sitting at Ready to Apply (or has already moved on) */
    done.ready = done.resume && done.cover && done.reviewed && done.link;

    const items = CHECKLIST.map(c => ({
      id: c.id,
      label: c.label,
      done: !!done[c.id],
      note: noteFor(c.id, done, pkg),
    }));
    const count = items.filter(i => i.done).length;
    return {
      items,
      done: count,
      total: items.length,
      progress: Math.round((count / items.length) * 100),
      complete: count === items.length,
    };
  }

  function noteFor(id, done, pkg) {
    if (id === 'resume') return done.resume ? (pkg.resumeName || 'Selected') : 'No résumé selected';
    if (id === 'cover') return done.cover ? 'Drafted' : 'Not generated yet';
    if (id === 'reviewed') return done.reviewed ? `Reviewed ${String(pkg.reviewedAt).slice(0, 10)}` : 'Open the package to review it';
    if (id === 'link') return done.link ? 'Apply link looks valid' : 'No usable application link';
    if (id === 'ready') return done.ready ? 'Everything is in place' : 'Finish the items above';
    return '';
  }

  /* ---------- the copyable application summary ---------- */

  function summaryText(pkg) {
    if (!pkg) return '';
    const job = pkg.job || {};
    const list = checklist(pkg);
    const lines = [];

    lines.push(`APPLICATION SUMMARY — ${job.company || ''}`);
    lines.push('='.repeat(52));
    lines.push('');
    lines.push(`Role:          ${job.title || '—'}`);
    lines.push(`Company:       ${job.company || '—'}`);
    if (job.location) lines.push(`Location:      ${job.location}${job.workMode ? ` (${job.workMode})` : ''}`);
    lines.push(`Source:        ${job.source || '—'}`);
    if (job.applyUrl) lines.push(`Apply at:      ${job.applyUrl}`);
    lines.push('');
    lines.push(`Match score:   ${pkg.matchScore == null ? '—' : pkg.matchScore + '%'}`);
    lines.push(`Résumé:        ${pkg.resumeName || '—'}`);
    lines.push(`Status:        ${(typeof ApplicationPackages !== 'undefined') ? ApplicationPackages.statusLabel(pkg.status) : pkg.status}`);
    lines.push(`Approved on:   ${pkg.approvedOn || '—'}`);
    if (pkg.appliedOn) lines.push(`Applied on:    ${pkg.appliedOn}`);
    lines.push('');
    lines.push(`Job summary:   ${pkg.jobSummary || jobSummary(job)}`);
    lines.push('');
    lines.push(`Checklist (${list.done}/${list.total} — ${list.progress}%)`);
    list.items.forEach(i => lines.push(`  [${i.done ? 'x' : ' '}] ${i.label} — ${i.note}`));
    lines.push('');
    lines.push('Cover letter is attached separately (copy it from the package).');
    return lines.join('\n');
  }

  /* best-effort clipboard; always returns the text so the caller can verify it */
  function copyText(text) {
    if (!text) return { ok: false, error: 'Nothing to copy' };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(text);
        if (p && p.catch) p.catch(() => { /* denied over file:// — the text is still returned */ });
      } else if (typeof document !== 'undefined' && document.execCommand) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { /* clipboard is best-effort */ }
    return { ok: true, text };
  }

  function copySummary(pkg) { return copyText(summaryText(pkg)); }

  return {
    CHECKLIST,
    jobSummary, resumeFor, suggestedKeywords, tailoringPreview,
    isVerifiableLink, checklist, summaryText, copyText, copySummary,
  };
})();
