/* ============================================================
   CertRecovery — recover certifications lost by the earlier
   destructive résumé synchronisation (Sprint 28 recovery).

   WHERE THE DATA COMES FROM
   Every tailored résumé variant stores a `plan`, and `plan.ops.certs` is a
   frozen snapshot of the profile's certifications at the moment that variant
   was generated — written as "Name — Issuer (Year)" by TailorEngine
   (masterContent → tailor). Those variants live in careerpilot_documents_v1
   and were never touched by the sync, so they still hold the complete list.

   WHAT THIS DOES
   Reads the variants, takes the LARGEST certification snapshot, compares it
   with the profile, and offers to add back only what is missing.

   • It never removes a certification.
   • On a duplicate, the profile's own version is kept and the snapshot's is
     skipped — the user's spelling, issuer and year win.
   • It reads and previews freely, but writes NOTHING until apply() is called
     explicitly from a confirmed action.
   • It touches ONLY `certifications`. Languages, authorization, links,
     preferences and employment scalars are never read or written here.
   ============================================================ */

const CertRecovery = (() => {

  const clean = s => String(s == null ? '' : s).trim();

  /* "AZ-104 Azure Administrator — Microsoft (2024)" → {name, issuer, year} */
  function parseCertLine(line) {
    const raw = clean(line);
    if (!raw) return null;
    const year = (raw.match(/\((\d{4})\)\s*$/) || [])[1] || '';
    const withoutYear = raw.replace(/\s*\((\d{4})\)\s*$/, '').trim();
    const parts = withoutYear.split(/\s+[—–-]\s+/);
    return {
      name: clean(parts[0]) || withoutYear,
      issuer: clean(parts.slice(1).join(' — ')),
      year,
    };
  }

  /* every certification snapshot stored in the Résumé Library */
  function snapshots() {
    if (typeof ResumesStore === 'undefined') return [];
    const variants = ResumesStore.load().variants || [];
    return variants
      .map(v => ({
        variantId: v.id,
        company: v.company,
        title: v.title,
        certs: (v.plan && v.plan.ops && Array.isArray(v.plan.ops.certs)) ? v.plan.ops.certs : [],
      }))
      .filter(s => s.certs.length);
  }

  /* the richest snapshot — the one that lost the least */
  function bestSnapshot() {
    const all = snapshots();
    if (!all.length) return null;
    return all.slice().sort((a, b) => b.certs.length - a.certs.length)[0];
  }

  /* ---------- the preview (read-only) ---------- */

  function preview(profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    const existing = (p && p.certifications) || [];
    const snap = bestSnapshot();

    if (!snap) {
      return {
        available: false,
        reason: 'No tailored résumé variant in the Résumé Library carries a saved certification list.',
        existing, toRestore: [], duplicates: [], source: null,
      };
    }

    const recovered = snap.certs.map(parseCertLine).filter(Boolean);
    const toRestore = [];
    const duplicates = [];

    recovered.forEach(c => {
      /* compare the whole record — name, issuer and aliases — so "PMP" and
         "Project Management Professional (PMP) — PMI (2019)" are one
         certification, whatever year each was written with */
      const held = existing.find(e => ParsedResume.sameCert(e, c));
      if (held) duplicates.push({ found: c.name, kept: held.name });
      else if (toRestore.some(t => ParsedResume.sameCert(t, c))) duplicates.push({ found: c.name, kept: c.name + ' (already in this list)' });
      else toRestore.push(c);
    });

    return {
      available: toRestore.length > 0,
      existing,
      toRestore,
      duplicates,
      source: { variantId: snap.variantId, company: snap.company, title: snap.title, count: snap.certs.length },
    };
  }

  /* ---------- apply (writes ONLY when called explicitly) ---------- */

  function apply(profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p) return { ok: false, error: 'The profile is not available', restored: 0 };

    const plan = preview(p);
    if (!plan.toRestore.length) {
      return { ok: true, restored: 0, skipped: plan.duplicates.length, certifications: p.certifications || [] };
    }

    /* a full snapshot before we write, exactly as a sync would take */
    if (typeof ParsedResume !== 'undefined') {
      ParsedResume.recordPreSyncBackup(p, { name: 'certification recovery' });
    }

    /* additive: existing entries keep their own spelling, issuer and year */
    p.certifications = ParsedResume.mergeCertifications(p.certifications, plan.toRestore);
    if (typeof ProfileStore !== 'undefined') ProfileStore.save(p);

    return {
      ok: true,
      restored: plan.toRestore.length,
      skipped: plan.duplicates.length,
      certifications: p.certifications,
    };
  }

  return { parseCertLine, snapshots, bestSnapshot, preview, apply };
})();
