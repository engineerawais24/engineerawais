/* ============================================================
   CareerData — the single source of career facts, resolved by
   priority (Sprint 28).

       1. user-confirmed profile data      (Profile)
       2. user-approved parsed résumé data (ParsedResume)
       3. demo / fallback data             (ResumesStore.EXPERIENCE)

   The profile wins because approving a parse WRITES the confirmed
   fields into it — so anything the user chose to keep, or edited by
   hand afterwards, stays authoritative.

   The rule this module exists to enforce: once an approved parsed
   résumé exists, tier 3 is switched off. Demo companies, demo
   locations and demo achievements can no longer reach a cover letter
   or an application package.

   Everything downstream — MatchEngine, ResumeRecommender, CoverLetter,
   PackageBuilder — already reads the Profile, so they inherit the
   real data automatically. This module only has to close the one hole
   they share: the hardcoded sample experience.
   ============================================================ */

const CareerData = (() => {

  function profile() {
    return (typeof Profile !== 'undefined') ? Profile.getState() : null;
  }

  function parsed() {
    return (typeof ParsedResume !== 'undefined' && ParsedResume.isApproved())
      ? ParsedResume.data()
      : null;
  }

  /* has the user approved a parsed résumé? once true, no demo data is used */
  function hasApproved() {
    return !!parsed();
  }

  /* which tier a given fact came from — used by the tests and the UI */
  function sourceOf(kind) {
    const p = profile();
    const d = parsed();
    switch (kind) {
      case 'experience':
        if (p && rolesFromProfile(p).length) return 'profile';
        if (d && d.employment.length) return 'parsed';
        return 'demo';
      case 'skills':
        if (p && (p.skills || []).length) return 'profile';
        if (d && d.skills.length) return 'parsed';
        return 'demo';
      case 'certifications':
        if (p && (p.certifications || []).length) return 'profile';
        if (d && d.certifications.length) return 'parsed';
        return 'demo';
      default:
        return p ? 'profile' : (d ? 'parsed' : 'demo');
    }
  }

  /* ---------- work history ---------- */

  /* the profile's own roles — WITHOUT ResumesView's demo fallback, which is
     precisely the placeholder this sprint has to stop using */
  function rolesFromProfile(p) {
    const roles = [];
    const e = (p && p.employment) || {};
    const bullets = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (String(e.title || '').trim() && String(e.company || '').trim()) {
      roles.push({
        title: e.title, company: e.company, location: '',
        period: (e.startDate || '—') + ' — ' + (e.current ? 'Present' : (e.endDate || '—')),
        bullets: bullets(e.highlights),
      });
    }
    ((p && p.history) || []).forEach(h => {
      if (!String(h.company || '').trim() && !String(h.title || '').trim()) return;
      roles.push({
        title: h.title || '—', company: h.company, location: h.location || '',
        period: (h.startDate || '—') + ' — ' + (h.current ? 'Present' : (h.endDate || '—')),
        bullets: bullets(h.highlights),
      });
    });
    return roles;
  }

  function rolesFromParsed(d) {
    return (d.employment || []).map(r => ({
      title: r.title || '—', company: r.company || '', location: r.location || '',
      period: (r.startDate || '—') + ' — ' + (r.current ? 'Present' : (r.endDate || '—')),
      bullets: (r.bullets || []).slice(),
    }));
  }

  /* the work history the letters and packages must use */
  function experience() {
    const p = profile();
    const fromProfile = p ? rolesFromProfile(p) : [];
    if (fromProfile.length) return fromProfile;                  // 1 — confirmed

    const d = parsed();
    if (d && d.employment.length) return rolesFromParsed(d);     // 2 — approved parse

    /* 3 — demo, but ONLY while no approved résumé exists */
    if (hasApproved()) return [];
    return (typeof ResumesStore !== 'undefined') ? (ResumesStore.EXPERIENCE || []) : [];
  }

  /* ---------- the rest ---------- */

  function skills() {
    const p = profile();
    if (p && (p.skills || []).length) return p.skills.slice();
    const d = parsed();
    return d ? d.skills.slice() : [];
  }

  function certifications() {
    const p = profile();
    if (p && (p.certifications || []).length) {
      return p.certifications.map(c => (c && c.name) ? c.name : String(c)).filter(Boolean);
    }
    const d = parsed();
    return d ? d.certifications.map(c => c.name).filter(Boolean) : [];
  }

  function targetRoles() {
    const p = profile();
    const fromProfile = (p && p.preferences && p.preferences.targetRoles) || '';
    if (String(fromProfile).trim()) return fromProfile;
    const d = parsed();
    return d ? d.roleKeywords.join(', ') : '';
  }

  function employer() {
    const p = profile();
    if (p && p.employment && String(p.employment.company || '').trim()) {
      return { title: p.employment.title, company: p.employment.company };
    }
    const d = parsed();
    const r = d && d.employment[0];
    return r ? { title: r.title, company: r.company } : { title: '', company: '' };
  }

  function location() {
    const p = profile();
    if (p && p.contact && String(p.contact.city || '').trim()) return p.contact.city;
    const d = parsed();
    return d ? d.contact.city : '';
  }

  function totalYears() {
    const p = profile();
    const fromProfile = (typeof MatchEngine !== 'undefined' && MatchEngine.yearsFromProfile && p)
      ? MatchEngine.yearsFromProfile(p) : null;
    if (fromProfile != null) return fromProfile;
    const d = parsed();
    return d ? d.totalYears : null;
  }

  return {
    hasApproved, sourceOf,
    rolesFromProfile, rolesFromParsed,
    experience, skills, certifications, targetRoles, employer, location, totalYears,
  };
})();
