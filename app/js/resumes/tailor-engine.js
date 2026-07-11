/* ============================================================
   TailorEngine — safe resume tailoring (Sprint 9C).

   THE SAFETY MODEL: tailoring is a declarative PLAN whose only
   operations are reorder / hide / promote / select over strings
   that already exist in the master content. The plan format has
   no way to express new text, so inventing experience, projects,
   certifications, employers, dates, technologies or duties is
   impossible by construction. verify() independently re-checks
   every string in a plan against the master (Resume Safety
   Score) and the Interview Safety Check blocks generation when
   any content lacks provenance.

   The uploaded master FILE stays locked and byte-identical —
   this engine reads the STRUCTURED master content derived from
   the profile (the same source the master preview renders).
   ============================================================ */

const TailorEngine = (() => {

  const lc = s => String(s || '').toLowerCase();

  /* information a posting may request that the master cannot answer */
  const INFO_MARKERS = [
    { re: /portfolio/i,             label: 'Portfolio',          check: p => !!p.links.portfolio },
    { re: /github/i,                label: 'GitHub',             check: p => !!p.links.github },
    { re: /work\s+samples?/i,       label: 'Work samples',       check: () => false },
    { re: /security\s+clearance/i,  label: 'Security clearance', check: () => false },
    { re: /driving\s+licen[cs]e/i,  label: 'Driving license',    check: () => false },
  ];

  /* ---------- the structured master (single source of truth) ---------- */

  function masterContent(profile) {
    return {
      summarySentences: String(profile.personal.summary || '')
        .split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean),
      skills: profile.skills.slice(),
      certifications: profile.certifications.filter(c => c.name)
        .map(c => `${c.name} — ${c.issuer} (${c.year})`),
      languages: profile.languages.filter(l => l.name).map(l => `${l.name} (${l.level})`),
      roles: ResumesView.rolesFrom(profile).map(r => ({
        title: r.title, company: r.company, period: r.period,
        bullets: r.bullets.slice(),
      })),
    };
  }

  function matchSkill(masterSkills, kw) {
    const k = lc(kw);
    return masterSkills.some(s => lc(s) === k || lc(s).includes(k) || k.includes(lc(s)));
  }

  /* ---------- analysis: suggestions + missing information ---------- */

  function analyze(master, jobLike, profile) {
    const kws = jobLike.skills || [];
    const matched = kws.filter(k => matchSkill(master.skills, k));
    const missing = kws.filter(k => !matched.includes(k));

    /* improvement tips — ONLY promote/move/highlight existing content */
    const tips = [];
    master.roles.forEach(role => {
      const hitKw = kws.find(k => role.bullets.slice(1).some(b => lc(b).includes(lc(k))));
      if (hitKw) tips.push(`Move the ${hitKw} bullet in ${role.company} to the top.`);
    });
    master.certifications.forEach(cert => {
      if (kws.some(k => lc(cert).includes(lc(k)))) tips.push(`Promote ${cert.split(' — ')[0]}.`);
    });
    kws.forEach(k => {
      if (!matchSkill(master.skills, k)
        && master.roles.some(r => r.bullets.some(b => lc(b).includes(lc(k))))) {
        tips.push(`Highlight ${k} — it's already in your experience bullets.`);
      }
    });
    if (matched.length) tips.push(`Surface ${matched.slice(0, 2).join(' and ')} at the top of your skills.`);

    /* missing information the job requests but the master can't prove */
    const haystack = [jobLike.description, (jobLike.skills || []).join(' ')].join(' ');
    const missingInfo = INFO_MARKERS
      .filter(m => m.re.test(haystack) && !m.check(profile))
      .map(m => ({ item: m.label, note: `The posting asks for ${m.label.toLowerCase()} — not available from your master resume. Needs manual review.` }));

    return { matched, missing, tips: tips.slice(0, 5), missingInfo };
  }

  /* ---------- tailoring: build a reorder/hide/emphasis plan ---------- */

  function tailor(master, jobLike, profile) {
    const kws = (jobLike.skills || []).map(lc);
    const hits = text => kws.filter(k => lc(text).includes(k)).length;
    const changes = [];

    /* skills: matched first (reorder only — same set) */
    const surfaced = master.skills.filter(s => kws.some(k => lc(s).includes(k) || k.includes(lc(s))));
    const skillsOrdered = [
      ...master.skills.filter(s => surfaced.includes(s)),
      ...master.skills.filter(s => !surfaced.includes(s)),
    ];
    if (surfaced.length && skillsOrdered.join() !== master.skills.join()) {
      changes.push({ type: 'skills', text: `Surfaced skills: ${surfaced.join(', ')}` });
    }

    /* certifications: matched first (reorder only) */
    const certMatched = master.certifications.filter(c => kws.some(k => lc(c).includes(k)));
    const certsOrdered = [
      ...certMatched,
      ...master.certifications.filter(c => !certMatched.includes(c)),
    ];
    certMatched.forEach(c => changes.push({ type: 'certs', text: `Highlighted certification: ${c.split(' — ')[0]}` }));

    /* roles: promote matching bullets, hide clearly irrelevant ones
       (only when a role has 3+ bullets and at least one match) */
    const roles = master.roles.map(role => {
      const scored = role.bullets.map((b, i) => ({ b, i, h: hits(b) }));
      const ordered = scored.slice().sort((a, b) => b.h - a.h || a.i - b.i);
      const anyMatch = scored.some(x => x.h > 0);
      const hidden = (anyMatch && role.bullets.length >= 3)
        ? ordered.filter(x => x.h === 0).slice(-1).map(x => x.b)   // hide at most one least-relevant
        : [];
      const visible = ordered.map(x => x.b).filter(b => !hidden.includes(b));
      scored.forEach(x => {
        if (x.h > 0 && ordered.findIndex(o => o.b === x.b) < x.i) {
          changes.push({ type: 'promoted', text: `Promoted in ${role.company}: “${x.b.slice(0, 70)}${x.b.length > 70 ? '…' : ''}”` });
        }
      });
      hidden.forEach(b => changes.push({ type: 'hidden', text: `Hidden in ${role.company} (less relevant): “${b.slice(0, 70)}${b.length > 70 ? '…' : ''}”` }));
      return { hidden, order: visible };
    });

    /* summary: SELECT existing sentences only (shorten/refocus) */
    let summaryText = master.summarySentences.join(' ');
    if (master.summarySentences.length > 1) {
      const ranked = master.summarySentences.slice()
        .sort((a, b) => hits(b) - hits(a));
      const chosen = ranked.slice(0, 2);
      const reordered = master.summarySentences.filter(s => chosen.includes(s));
      if (reordered.join(' ') !== summaryText) {
        summaryText = reordered.join(' ');
        changes.push({ type: 'summary', text: 'Summary focused on the most relevant sentences (no new wording)' });
      }
    }

    /* section ordering: skills before summary when the match is skills-heavy */
    const skillsFirst = surfaced.length >= 3;
    if (skillsFirst) changes.push({ type: 'section', text: 'Moved Skills above Summary for this role' });

    const plan = {
      company: jobLike.company, title: jobLike.title,
      ops: { skills: skillsOrdered, certs: certsOrdered, roles, summaryText, skillsFirst, highlights: surfaced },
      changes,
    };

    plan.safety = verify(plan, master);
    plan.interviewCheck = interviewCheck(plan);
    return plan;
  }

  /* ---------- verification: every string must trace to the master ---------- */

  function verify(plan, master) {
    const unsupported = [];
    const inSet = (arr, v) => arr.includes(v);

    plan.ops.skills.forEach(s => { if (!inSet(master.skills, s)) unsupported.push(`Skill: ${s}`); });
    plan.ops.certs.forEach(c => { if (!inSet(master.certifications, c)) unsupported.push(`Certification: ${c}`); });
    plan.ops.roles.forEach((r, i) => {
      const src = master.roles[i] ? master.roles[i].bullets : [];
      [...r.order, ...r.hidden].forEach(b => { if (!inSet(src, b)) unsupported.push(`Bullet: ${String(b).slice(0, 60)}`); });
    });
    String(plan.ops.summaryText || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
      .forEach(s => { if (!inSet(master.summarySentences, s)) unsupported.push(`Summary sentence: ${s.slice(0, 60)}`); });

    return {
      score: unsupported.length === 0 ? 100 : Math.max(0, 100 - unsupported.length * 20),
      unsupported,
      verified: plan.ops.skills.length + plan.ops.certs.length
        + plan.ops.roles.reduce((n, r) => n + r.order.length + r.hidden.length, 0),
    };
  }

  /* Interview Safety Check: the candidate must be able to explain
     every bullet — i.e. every bullet traces verbatim to the master. */
  function interviewCheck(plan) {
    const issues = (plan.safety ? plan.safety.unsupported : []).slice();
    return {
      pass: issues.length === 0,
      issues: issues.length
        ? issues.map(u => `Unverifiable content would appear on the resume: ${u}`)
        : [],
      note: issues.length === 0
        ? 'Every bullet traces verbatim to your master resume — you can explain all of it.'
        : 'Blocked: content without provenance can\'t be defended in an interview.',
    };
  }

  return { masterContent, analyze, tailor, verify, interviewCheck, INFO_MARKERS };
})();
