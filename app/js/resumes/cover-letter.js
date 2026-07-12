/* ============================================================
   CoverLetter — template-based cover-letter generator (Sprint 22).

   Deterministic string templating. NO AI, no network, no backend.
   Every sentence is built from facts that already exist: the job
   record, the saved Profile and the résumé selected for that job
   (Sprint 21). Nothing is invented — if a fact is missing the
   sentence is simply left out.

   One letter per job, persisted through the existing AppStorage
   platform abstraction. It never touches the locked master résumé,
   the Résumé Library, a decision or an application package (the
   Approvals flow keeps its own separate letter).
   ============================================================ */

const CoverLetter = (() => {

  const STORAGE_KEY = 'cover_letters';

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  function store() {
    const o = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    return (o && typeof o === 'object') ? o : {};
  }
  function persist(o) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, o);
    return o;
  }

  /* does `needle` appear in this list of terms? (loose, case-insensitive) */
  function listHas(terms, needle) {
    const k = lc(needle);
    return (terms || []).some(t => {
      const a = lc(t);
      return a === k || a.indexOf(k) !== -1 || k.indexOf(a) !== -1;
    });
  }

  /* the job's required skills that are actually on the profile */
  function matchingSkills(job, profile) {
    return (job.skills || []).filter(s => listHas(profile.skills || [], s));
  }

  function resumeFor(job) {
    if (typeof ResumeRecommender === 'undefined') return null;
    const r = ResumeRecommender.forJob(job);
    return r ? r.selected : null;
  }

  /* ---------- what the SELECTED résumé brings ----------
     Each résumé is a different document: its own role family (category),
     its own leading keywords and, therefore, its own strongest experience
     bullets. Change the résumé and all three of these change — which is
     what makes the regenerated letter genuinely different. */

  const CATEGORY_PHRASE = {
    architect: 'solutions-architecture',
    consultant: 'consulting and client-delivery',
    implementation: 'implementation and rollout',
    engineer: 'hands-on solutions-engineering',
    general: 'solutions',
  };

  function resumeTitle(resume, profile) {
    return (resume && resume.title)
      || (profile.personal && profile.personal.headline)
      || '';
  }
  function categoryOf(title) {
    return (typeof MatchEngine !== 'undefined') ? MatchEngine.categoryOf(title) : 'general';
  }
  /* the keywords this résumé leads with — the Résumé Library's role families */
  function resumeKeywords(resume, profile) {
    return (typeof ResumesStore !== 'undefined' && ResumesStore.keywordsFor)
      ? ResumesStore.keywordsFor(resumeTitle(resume, profile))
      : [];
  }

  /* a keyword lands in a bullet if any of its words stems into it */
  function bulletMentions(bullet, keyword) {
    const text = lc(bullet);
    return lc(keyword).split(/[^a-z]+/)
      .filter(w => w.length >= 4)
      .some(w => text.indexOf(w.slice(0, 5)) !== -1);
  }

  /* the two experience bullets this résumé leads with, best first */
  function evidenceFor(resume, profile) {
    const roles = (typeof ResumesStore !== 'undefined') ? (ResumesStore.EXPERIENCE || []) : [];
    const kws = resumeKeywords(resume, profile);
    const scored = [];
    roles.forEach(r => (r.bullets || []).forEach(b => {
      scored.push({ text: b, role: r.title, company: r.company, hits: kws.filter(k => bulletMentions(b, k)).length });
    }));
    /* Array.prototype.sort is stable, so equal scores keep résumé order */
    const ranked = scored.slice().sort((a, b) => b.hits - a.hits);
    const hit = ranked.filter(x => x.hits > 0).slice(0, 2);
    return hit.length ? hit : scored.slice(0, 1);   // fall back to the most recent bullet
  }

  /* ---------- the template ---------- */
  function compose(job, profile, resume, facts) {
    const p = profile;
    const name = `${p.personal.firstName || ''} ${p.personal.lastName || ''}`.trim() || 'Your Name';
    const city = (p.contact && p.contact.city) || '';
    const email = (p.contact && p.contact.email) || '';
    const linkedin = (p.links && p.links.linkedin) || '';
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const asked = (job.skills || []).slice(0, 4).join(', ');
    const phrase = CATEGORY_PHRASE[facts.resumeCategory] || CATEGORY_PHRASE.general;

    const lines = [];
    lines.push(today);
    lines.push('');
    lines.push(`Dear ${job.company} Hiring Team,`);
    lines.push('');

    /* opening — the job, and the RÉSUMÉ being sent with it */
    lines.push(
      `I'm writing to apply for the ${job.title} role at ${job.company}`
      + (job.source ? `, which I found via ${job.source}` : '')
      + `. I'm applying with my ${resume ? resume.name : 'master'} résumé — a ${phrase} profile`
      + (city ? `, and I'm based in ${city}` : '')
      + `.`
    );
    lines.push('');

    /* the skills THIS résumé leads with — never a skill the profile lacks */
    if (asked) {
      let para = `Your posting calls for ${asked}.`;
      if (facts.resumeSkills.length) {
        para += ` That résumé leads on ${facts.resumeSkills.join(', ')}, which is where most of my ${phrase} work has been.`;
      } else if (facts.matchedSkills.length) {
        para += ` I bring hands-on experience with ${facts.matchedSkills.join(', ')}.`;
      }
      if (facts.otherSkills.length) {
        para += ` I also bring ${facts.otherSkills.join(', ')}.`;
      }
      if (facts.gapSkills.length) {
        para += ` I'm comfortable getting up to speed on ${facts.gapSkills.join(', ')}.`;
      }
      lines.push(para);
      lines.push('');
    }

    /* the experience that résumé puts first */
    if (facts.evidence.length) {
      lines.push(`Two things from it that speak directly to this role:`);
      facts.evidence.forEach(e => lines.push(`  • ${e.text} (${e.role}, ${e.company})`));
      lines.push('');
    }

    /* current employment, when it's on the profile */
    const emp = p.employment || {};
    if (emp.company && emp.title) {
      lines.push(`I'm currently a ${emp.title} at ${emp.company}, where I own technical delivery end to end.`);
      lines.push('');
    }

    /* Sprint 27 — certifications, stated only when the profile holds them */
    if (facts.certifications.length) {
      lines.push(`I hold ${facts.certifications.join(', ')}.`);
      lines.push('');
    }

    /* Sprint 27 — the role's own location, addressed directly */
    if (job.location) {
      const remote = /remote/i.test(job.location) || job.workMode === 'Remote';
      const prefersRemote = /remote/i.test((p.preferences && p.preferences.workMode) || '');
      lines.push(remote && prefersRemote
        ? `The role is remote, which is how I already work with clients across regions.`
        : `The role is based in ${job.location}${city ? `, and I'm currently in ${city}` : ''}.`);
      lines.push('');
    }

    lines.push(`I'd welcome the chance to talk about how I can help ${job.company}. Thank you for your time.`);
    lines.push('');
    lines.push('Sincerely,');
    lines.push(name);
    if (email) lines.push(email);
    if (linkedin) lines.push(linkedin);

    return lines.join('\n');
  }

  /* ---------- generate / read / regenerate ---------- */
  function build(job) {
    const profile = (typeof Profile !== 'undefined') ? Profile.getState() : { personal: {}, contact: {}, links: {}, skills: [], employment: {} };
    const resume = resumeFor(job);

    /* everything the letter is allowed to claim, derived from the SELECTED résumé */
    const kws = resumeKeywords(resume, profile);
    const matchedSkills = matchingSkills(job, profile);                    // job ∩ profile
    const resumeSkills = matchedSkills.filter(s => listHas(kws, s));       // …that this résumé leads with
    const otherSkills = matchedSkills.filter(s => !listHas(kws, s));       // …that it doesn't
    const gapSkills = (job.skills || []).filter(s => !listHas(profile.skills || [], s));

    const facts = {
      resumeCategory: categoryOf(resumeTitle(resume, profile)),
      resumeKeywords: kws,
      matchedSkills, resumeSkills, otherSkills, gapSkills,
      evidence: evidenceFor(resume, profile),
      /* Sprint 27: the certifications the profile actually holds */
      certifications: (profile.certifications || [])
        .map(c => (c && c.name) ? c.name : String(c))
        .filter(Boolean),
    };

    return Object.assign({
      jobId: job.id,
      text: compose(job, profile, resume, facts),
      resumeId: resume ? resume.id : null,
      resumeName: resume ? resume.name : null,
      generatedAt: Date.now(),
    }, facts);
  }

  function generate(job) {
    if (!job || !job.id) return null;
    const letter = build(job);
    const all = store();
    all[job.id] = letter;
    persist(all);
    return letter;
  }

  function get(jobId) { return store()[jobId] || null; }
  function has(jobId) { return !!store()[jobId]; }
  function regenerate(job) { return generate(job); }

  function remove(jobId) {
    const all = store();
    if (!all[jobId]) return false;
    delete all[jobId];
    persist(all);
    return true;
  }
  function clear() { persist({}); }

  /* Requirement 3: if the résumé selected for this job has changed since
     the letter was written, rebuild it. Returns the current letter. */
  function syncToResume(job) {
    const existing = get(job.id);
    if (!existing) return null;
    const resume = resumeFor(job);
    const nowId = resume ? resume.id : null;
    if (existing.resumeId === nowId) return existing;
    return generate(job);                    // résumé changed → regenerate
  }

  /* best-effort clipboard copy; always returns the text so a caller
     (and the tests) can verify what would be copied */
  function copy(jobId) {
    const l = get(jobId);
    if (!l) return { ok: false, error: 'No cover letter to copy' };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(l.text);
        if (p && p.catch) p.catch(() => { /* denied over file:// — the text is still returned */ });
      } else if (typeof document !== 'undefined' && document.execCommand) {
        const ta = document.createElement('textarea');
        ta.value = l.text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { /* clipboard is best-effort; the text is still returned */ }
    return { ok: true, text: l.text };
  }

  return {
    STORAGE_KEY, CATEGORY_PHRASE,
    generate, regenerate, get, has, remove, clear,
    syncToResume, copy, matchingSkills, resumeKeywords, evidenceFor, compose, build,
  };
})();
