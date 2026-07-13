/* ============================================================
   CertHierarchy — certification intelligence (Sprint 29).

   Certifications are not flat keywords: they form LADDERS, and a
   higher rung proves the lower ones.

     Cisco    CCNA  <  CCNP  <  CCIE
     Juniper  JNCIA <  JNCIS <  JNCIP <  JNCIE
     PMI      CAPM  <  PMP   <  PgMP
     Azure    AZ-900 < AZ-104 < AZ-305

   So a posting asking for CCNP is satisfied by CCNP or CCIE — but NOT
   by CCNA. A posting asking for JNCIA is satisfied by any Juniper rung.
   A posting asking for PMP is satisfied by PMP.

   Ladders are data, not code: addLadder() extends them at runtime.
   Name normalisation reuses ParsedResume's alias logic when it is
   loaded (so "Juniper Networks Certified Associate – Junos" is JNCIA),
   and falls back to a local normaliser when it is not.
   ============================================================ */

const CertHierarchy = (() => {

  const lc = s => String(s == null ? '' : s).toLowerCase().trim();

  /* levels[0] is the lowest rung. Each rung lists the spellings that mean it. */
  const DEFAULT_LADDERS = [
    { id: 'cisco', vendor: 'Cisco', levels: [
      { key: 'ccna', names: ['ccna', 'cisco certified network associate'] },
      { key: 'ccnp', names: ['ccnp', 'cisco certified network professional'] },
      { key: 'ccie', names: ['ccie', 'cisco certified internetwork expert'] },
    ] },
    { id: 'juniper', vendor: 'Juniper', levels: [
      { key: 'jncia', names: ['jncia', 'jncia-junos', 'juniper networks certified associate', 'juniper networks certified internet associate'] },
      { key: 'jncis', names: ['jncis', 'juniper networks certified specialist', 'juniper networks certified internet specialist'] },
      { key: 'jncip', names: ['jncip', 'juniper networks certified professional', 'juniper networks certified internet professional'] },
      { key: 'jncie', names: ['jncie', 'juniper networks certified expert', 'juniper networks certified internet expert'] },
    ] },
    { id: 'pmi', vendor: 'PMI', levels: [
      { key: 'capm', names: ['capm', 'certified associate in project management'] },
      { key: 'pmp', names: ['pmp', 'project management professional'] },
      { key: 'pgmp', names: ['pgmp', 'program management professional'] },
    ] },
    { id: 'azure', vendor: 'Microsoft', levels: [
      { key: 'az900', names: ['az-900', 'az 900', 'azure fundamentals'] },
      { key: 'az104', names: ['az-104', 'az 104', 'azure administrator'] },
      { key: 'az305', names: ['az-305', 'az 305', 'azure solutions architect'] },
    ] },
    { id: 'aws', vendor: 'AWS', levels: [
      { key: 'aws-cp', names: ['aws certified cloud practitioner', 'cloud practitioner'] },
      { key: 'aws-saa', names: ['aws certified solutions architect associate', 'aws solutions architect associate'] },
      { key: 'aws-sap', names: ['aws certified solutions architect professional', 'aws solutions architect professional'] },
    ] },
    { id: 'paloalto', vendor: 'Palo Alto Networks', levels: [
      { key: 'pcnsa', names: ['pcnsa', 'palo alto networks certified network security administrator'] },
      { key: 'pcnse', names: ['pcnse', 'palo alto networks certified network security engineer'] },
    ] },
    { id: 'comptia-sec', vendor: 'CompTIA', levels: [
      { key: 'security+', names: ['security+', 'comptia security+', 'comptia security plus'] },
      { key: 'cysa+', names: ['cysa+', 'comptia cysa+'] },
      { key: 'casp+', names: ['casp+', 'comptia casp+'] },
    ] },
    { id: 'kubernetes', vendor: 'CNCF', levels: [
      { key: 'cka', names: ['cka', 'certified kubernetes administrator'] },
    ] },
  ];

  let LADDERS = DEFAULT_LADDERS.map(l => Object.assign({}, l, { levels: l.levels.map(x => Object.assign({}, x)) }));

  function addLadder(ladder) {
    if (!ladder || !ladder.id || !Array.isArray(ladder.levels)) return null;
    const existing = LADDERS.findIndex(l => l.id === ladder.id);
    if (existing !== -1) LADDERS[existing] = ladder;
    else LADDERS.push(ladder);
    return ladder;
  }
  function reset() {
    LADDERS = DEFAULT_LADDERS.map(l => Object.assign({}, l, { levels: l.levels.map(x => Object.assign({}, x)) }));
  }
  function ladders() { return LADDERS; }

  /* ---------- naming ---------- */

  /* a name matches a rung when it says one of the rung's spellings */
  function mentions(name, spelling) {
    const n = lc(name).replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
    const s = lc(spelling);
    if (!n || !s) return false;
    if (n === s) return true;
    /* whole-token containment: "PCNSE — Palo Alto (2021)" mentions "pcnse",
       but "cka" must not match inside "ckad" */
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9+])' + esc + '([^a-z0-9+]|$)').test(n);
  }

  /* where does this certification sit? { ladder, level, index, key } or null */
  function find(cert) {
    const name = (cert && cert.name) ? cert.name : cert;
    for (const ladder of LADDERS) {
      for (let i = 0; i < ladder.levels.length; i++) {
        if (ladder.levels[i].names.some(s => mentions(name, s))) {
          return { ladderId: ladder.id, vendor: ladder.vendor, key: ladder.levels[i].key, index: i, levels: ladder.levels.length };
        }
      }
    }
    return null;
  }

  function isKnown(cert) { return !!find(cert); }

  /* ---------- satisfaction ----------
     A requirement is met by the same certification, or by a HIGHER rung of
     the same ladder. A lower rung does not meet it. */
  function satisfies(required, held) {
    const req = find(required);
    const list = Array.isArray(held) ? held : [held];

    /* an unknown certification can only be met by naming it literally */
    if (!req) {
      const literal = list.find(h => {
        const hn = (h && h.name) ? h.name : h;
        const rn = (required && required.name) ? required.name : required;
        if (typeof ParsedResume !== 'undefined' && ParsedResume.sameCert) return ParsedResume.sameCert(hn, rn);
        return lc(hn) === lc(rn);
      });
      return literal
        ? { ok: true, by: literal, level: 'exact', note: null }
        : { ok: false, by: null, level: 'none', note: null };
    }

    let best = null;
    list.forEach(h => {
      const got = find(h);
      if (!got || got.ladderId !== req.ladderId) return;
      if (got.index < req.index) return;                    // a lower rung proves nothing
      if (!best || got.index > best.got.index) best = { held: h, got };
    });

    if (!best) return { ok: false, by: null, level: 'none', note: null };

    const higher = best.got.index > req.index;
    return {
      ok: true,
      by: best.held,
      level: higher ? 'higher' : 'exact',
      note: higher
        ? `${String((best.held && best.held.name) || best.held).trim()} is above the required ${req.key.toUpperCase()}`
        : null,
    };
  }

  /* ---------- what a posting asks for ----------
     Read from the job's own text. Nothing is assumed: a posting that names
     no certification requires none. */
  function requiredBy(job) {
    if (!job) return [];
    const hay = [job.title, job.description, (job.skills || []).join(' '), (job.preferredSkills || []).join(' ')]
      .filter(Boolean).join(' ');
    const found = [];
    LADDERS.forEach(ladder => {
      ladder.levels.forEach(level => {
        if (level.names.some(s => mentions(hay, s)) && !found.some(f => f.key === level.key)) {
          found.push({ key: level.key, ladderId: ladder.id, vendor: ladder.vendor, name: level.names[0].toUpperCase() });
        }
      });
    });
    /* when a posting names two rungs of one ladder ("CCNA or CCNP"), the
       LOWEST is the real requirement */
    const byLadder = {};
    found.forEach(f => {
      const idx = find(f.key).index;
      if (!byLadder[f.ladderId] || idx < byLadder[f.ladderId].index) byLadder[f.ladderId] = { f, index: idx };
    });
    return Object.keys(byLadder).map(k => byLadder[k].f);
  }

  return { DEFAULT_LADDERS, ladders, addLadder, reset, find, isKnown, mentions, satisfies, requiredBy };
})();
