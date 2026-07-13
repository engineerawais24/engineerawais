/* ============================================================
   ParsedResume — the structured résumé profile, its review state
   and the confirmed synchronisation into the CareerPilot profile
   (Sprint 28).

   Status:  not_parsed → parsing → needs_review → approved
                                 ↘ failed

   The uploaded master résumé file is NEVER modified — this store
   holds a separate structured record, persisted through the existing
   AppStorage platform layer.

   Synchronisation is never silent: diff() shows the user exactly what
   would change, and only the fields they confirm are written into the
   profile. Anything they leave unticked keeps its current value, so
   user-edited profile data always wins (source priority 1).
   ============================================================ */

const ParsedResume = (() => {

  const STORAGE_KEY = 'parsed_resume';

  const STATUSES = ['not_parsed', 'parsing', 'needs_review', 'approved', 'failed'];
  const STATUS_LABEL = {
    not_parsed: 'Not parsed',
    parsing: 'Parsing',
    needs_review: 'Needs review',
    approved: 'Approved',
    failed: 'Failed',
  };

  const clean = s => String(s == null ? '' : s).trim();
  const lc = s => clean(s).toLowerCase();

  /* ============================================================
     Certification identity (Sprint 28 fix)

     A parse must NEVER delete a certification the user already had. To add
     only what is genuinely new, we need to know when two differently-written
     names are the same certification:

       "JNCIA-Junos"
       "JNCIA Junos"
       "Juniper Networks Certified Associate – Junos"

     …are one certification. We canonicalise by expanding known vendor
     phrasings to their acronym, dropping filler words, and comparing the
     remaining distinctive tokens as a set. When two names collide, the
     EXISTING (user-confirmed) spelling is the one that is kept.
     ============================================================ */

  /* expansion → acronym. Extend this table as new vendors appear. */
  const CERT_ALIASES = [
    { acronym: 'jncia', phrases: ['juniper networks certified internet associate', 'juniper networks certified associate'] },
    { acronym: 'jncis', phrases: ['juniper networks certified internet specialist', 'juniper networks certified specialist'] },
    { acronym: 'jncip', phrases: ['juniper networks certified internet professional', 'juniper networks certified professional'] },
    { acronym: 'jncie', phrases: ['juniper networks certified internet expert', 'juniper networks certified expert'] },
    { acronym: 'cka', phrases: ['certified kubernetes administrator'] },
    { acronym: 'ckad', phrases: ['certified kubernetes application developer'] },
    { acronym: 'ccna', phrases: ['cisco certified network associate'] },
    { acronym: 'ccnp', phrases: ['cisco certified network professional'] },
    { acronym: 'rhcsa', phrases: ['red hat certified system administrator'] },
    { acronym: 'rhce', phrases: ['red hat certified engineer'] },
    { acronym: 'az104', phrases: ['azure administrator associate', 'azure administrator'] },
    { acronym: 'az305', phrases: ['azure solutions architect expert', 'azure solutions architect'] },
    { acronym: 'awssaa', phrases: ['aws certified solutions architect associate'] },
    { acronym: 'pmp', phrases: ['project management professional'] },
    { acronym: 'capm', phrases: ['certified associate in project management'] },
    { acronym: 'cissp', phrases: ['certified information systems security professional'] },
    { acronym: 'ceh', phrases: ['certified ethical hacker'] },
    { acronym: 'itil', phrases: ['itil foundation', 'information technology infrastructure library'] },
    { acronym: 'ccie', phrases: ['cisco certified internetwork expert'] },
    { acronym: 'mcse', phrases: ['microsoft certified solutions expert'] },
    { acronym: 'togaf', phrases: ['the open group architecture framework'] },
    { acronym: 'pcnse', phrases: ['palo alto networks certified network security engineer'] },
    { acronym: 'pcnsa', phrases: ['palo alto networks certified network security administrator'] },
    { acronym: 'pccse', phrases: ['palo alto networks certified cloud security engineer'] },
    { acronym: 'nse', phrases: ['fortinet network security expert'] },
    { acronym: 'comptiasec', phrases: ['comptia security+', 'comptia security plus'] },
  ];

  /* words that carry no identity of their own */
  const CERT_FILLER = [
    'certified', 'certification', 'certificate', 'certificates', 'cert',
    'associate', 'professional', 'expert', 'specialist', 'administrator',
    'engineer', 'developer', 'network', 'networks', 'internet', 'level',
    'exam', 'badge', 'credential', 'the', 'of', 'and', 'in', 'on',
  ];

  /* "JNCIA-Junos" → "jncia junos" ; "Juniper Networks Certified Associate – Junos" → "jncia junos" */
  function certKey(name) {
    let s = lc(name)
      .replace(/[‐-―]/g, ' ')          // every flavour of dash
      .replace(/[^a-z0-9+#]+/g, ' ')             // punctuation out, keep C++/C#
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';

    /* expand a known vendor phrasing to its acronym */
    CERT_ALIASES.forEach(a => {
      a.phrases.forEach(phrase => {
        if (s.indexOf(phrase) !== -1) s = s.replace(phrase, a.acronym);
      });
    });
    /* "az 104" → "az104" so it matches the acronym form */
    s = s.replace(/\b([a-z]{2})\s+(\d{3})\b/g, '$1$2');

    const tokens = s.split(' ')
      .filter(Boolean)
      .filter(t => CERT_FILLER.indexOf(t) === -1);

    /* a name made only of filler still deserves an identity */
    const distinct = Array.from(new Set(tokens.length ? tokens : s.split(' ').filter(Boolean)));
    return distinct.sort().join(' ');
  }

  /* Every identity a certification answers to: its token key, any acronym it
     spells out in brackets — "Project Management Professional (PMP)" — the
     acronym of any vendor phrasing it uses, and, when the whole name IS one
     word, that word. Two certifications sharing ANY of these are the same.

     Deliberately conservative: an acronym is only taken from brackets, from
     the alias table, or from a single-word name. It is never guessed from
     capitals, so "AWS Certified Developer" and "AWS Certified Architect" stay
     distinct. */
  function acronymsOf(name) {
    const out = [];
    const add = t => {
      const v = lc(t).replace(/[^a-z0-9+#]/g, '');
      if (v && v.length >= 2 && v.length <= 10 && !/^\d+$/.test(v) && out.indexOf(v) === -1) out.push(v);
    };

    /* "(PMP)" — but not "(2021)" */
    const raw = String(name || '');
    const re = /\(([^)]{2,14})\)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const inner = m[1].trim();
      if (!/^\d{4}$/.test(inner) && /^[A-Za-z0-9 .+#-]+$/.test(inner) && inner.split(/\s+/).length <= 2) add(inner);
    }

    /* an alias, written either as the acronym or spelled out in full */
    const flat = lc(raw).replace(/[^a-z0-9+#]+/g, ' ');
    CERT_ALIASES.forEach(a => {
      if (a.phrases.some(p => flat.indexOf(p) !== -1)) add(a.acronym);
      else if (new RegExp('(^| )' + a.acronym + '( |$)').test(flat)) add(a.acronym);
    });

    /* a name that is a single word is its own acronym */
    const key = certKey(raw);
    if (key && key.indexOf(' ') === -1) add(key);

    /* résumés group certifications under a heading, and the heading comes
       along for the ride: "Security Vendors: PCNSE". A colon segment that is
       a SINGLE word is the certification itself, so it becomes an identity.
       A multi-word segment is not — otherwise "AWS: Solutions Architect" and
       "Azure: Solutions Architect" would collapse into one. */
    if (raw.indexOf(':') !== -1) {
      raw.split(':').forEach(seg => {
        const k = certKey(seg);
        if (k && k.indexOf(' ') === -1) add(k);
      });
    }

    return out;
  }

  function certRecord(v) {
    if (typeof v === 'string') return { name: v, issuer: '' };
    return { name: (v && v.name) || '', issuer: (v && v.issuer) || '' };
  }

  /* Same certification? Names normalised for case, punctuation, spacing and
     vendor phrasing; the YEAR is never part of the identity, so the same
     certification renewed in a different year is still the same one. The
     issuer is a corroborating signal, not a requirement. */
  function sameCert(a, b) {
    const A = certRecord(a), B = certRecord(b);
    const ka = certKey(A.name), kb = certKey(B.name);
    if (!ka || !kb) return false;
    if (ka === kb) return true;                              // identical after normalising

    const acA = acronymsOf(A.name), acB = acronymsOf(B.name);
    if (acA.some(x => acB.indexOf(x) !== -1)) return true;   // they share an acronym

    /* same issuer, and one name is just a longer way of writing the other */
    const iA = norm(A.issuer), iB = norm(B.issuer);
    if (iA && iA === iB) {
      const tA = ka.split(' '), tB = kb.split(' ');
      if (tA.every(t => tB.indexOf(t) !== -1) || tB.every(t => tA.indexOf(t) !== -1)) return true;
    }
    return false;
  }

  /* the certification list, MERGED — never replaced.
     Existing entries are kept exactly as the user wrote them; only genuinely
     new ones are appended. Nothing is ever removed. */
  function mergeCertifications(existing, parsed) {
    const out = (existing || [])
      .filter(c => c && clean(c.name))
      .map(c => ({ name: clean(c.name), issuer: clean(c.issuer), year: clean(c.year) }));

    (parsed || []).forEach(c => {
      const cand = certRecord(c);
      if (!clean(cand.name)) return;
      /* already held (in any spelling) → keep the user's version, drop this one */
      if (out.some(held => sameCert(held, cand))) return;
      out.push({ name: clean(cand.name), issuer: clean(c && c.issuer), year: clean(c && c.year) });
    });
    return out;
  }

  /* which parsed certifications are actually NEW (and not duplicates of each other) */
  function newCertifications(existing, parsed) {
    const held = (existing || []).filter(c => c && clean(c.name));
    const out = [];
    (parsed || []).forEach(c => {
      const cand = certRecord(c);
      if (!clean(cand.name)) return;
      if (held.some(h => sameCert(h, cand))) return;
      if (out.some(o => sameCert(o, cand))) return;
      out.push(c);
    });
    return out;
  }

  /* skills merge on the same rule: additive, case-insensitive, never deletes */
  function mergeSkills(existing, parsed) {
    const out = (existing || []).map(clean).filter(Boolean);
    const keys = out.map(lc);
    (parsed || []).forEach(s => {
      const v = clean(s);
      if (!v || keys.indexOf(lc(v)) !== -1) return;
      out.push(v);
      keys.push(lc(v));
    });
    return out;
  }
  function newSkills(existing, parsed) {
    const keys = (existing || []).map(lc);
    return (parsed || []).filter(s => clean(s) && keys.indexOf(lc(s)) === -1);
  }

  /* ============================================================
     Employment history — merged, never replaced.

     Records are matched on normalized company + title + start month. A
     matched record keeps everything it had and gains only the bullets it
     was missing; an unmatched parsed record is appended. No existing record
     and no existing bullet is ever removed.

     The one exception is data the user never typed: an entry that is still
     byte-for-byte the demo history CareerPilot ships with is not user data,
     so parsed data may take its place. Anything the user touched is kept.
     ============================================================ */

  const norm = s => lc(s).replace(/[^a-z0-9]+/g, ' ').trim();

  function empKey(r) {
    return [norm(r && r.company), norm(r && r.title), String((r && r.startDate) || '').slice(0, 7)].join('|');
  }

  const bulletsOf = h => String(h || '').split('\n').map(s => s.trim()).filter(Boolean);

  function mergeBullets(existing, incoming) {
    const out = (existing || []).map(clean).filter(Boolean);
    const keys = out.map(lc);
    (incoming || []).forEach(b => {
      const v = clean(b);
      if (!v || keys.indexOf(lc(v)) !== -1) return;      // already written → keep the user's wording
      out.push(v);
      keys.push(lc(v));
    });
    return out;
  }

  /* is this record still the untouched demo entry CareerPilot ships with? */
  function isShippedHistory(h) {
    if (typeof ProfileStore === 'undefined') return false;
    return (ProfileStore.defaults().history || []).some(d =>
      norm(d.company) === norm(h.company)
      && norm(d.title) === norm(h.title)
      && String(d.startDate || '') === String(h.startDate || '')
      && String(d.highlights || '') === String(h.highlights || ''));
  }
  function isShippedEmployment(e) {
    if (typeof ProfileStore === 'undefined' || !e) return false;
    const d = ProfileStore.defaults().employment;
    return norm(d.company) === norm(e.company)
      && norm(d.title) === norm(e.title)
      && String(d.highlights || '') === String(e.highlights || '');
  }

  function mergeHistory(existing, parsedRoles) {
    /* keep every record the user has — demo entries they never touched are
       not "theirs", so parsed data is allowed to supersede those */
    const out = (existing || [])
      .filter(h => h && (clean(h.company) || clean(h.title)))
      .filter(h => !isShippedHistory(h))
      .map(h => Object.assign({}, h));
    const keys = out.map(empKey);

    (parsedRoles || []).forEach(r => {
      if (!r || (!clean(r.company) && !clean(r.title))) return;
      const i = keys.indexOf(empKey(r));
      if (i !== -1) {
        /* the same role — add the bullets it was missing, remove nothing */
        out[i].highlights = mergeBullets(bulletsOf(out[i].highlights), r.bullets).join('\n');
        if (!clean(out[i].location) && clean(r.location)) out[i].location = r.location;
        if (!clean(out[i].endDate) && clean(r.endDate)) out[i].endDate = r.endDate;
        if (!clean(out[i].startDate) && clean(r.startDate)) out[i].startDate = r.startDate;
        return;
      }
      out.push({
        id: 'emp-parsed-' + (out.length + 1),
        company: r.company || '', title: r.title || '', location: r.location || '',
        startDate: r.startDate || '', endDate: r.endDate || '', current: !!r.current,
        highlights: (r.bullets || []).join('\n'),
        source: 'resume-parse',
      });
      keys.push(empKey(r));
    });
    return out;
  }

  /* ---------- storage ---------- */

  function blank() {
    return {
      status: 'not_parsed',
      data: null,
      missing: [],
      completeness: 0,
      error: null,
      errorCode: null,
      sourceFile: null,
      parsedAt: null,
      approvedAt: null,
      appliedFields: [],
    };
  }

  function load() {
    const rec = (typeof AppStorage !== 'undefined') ? AppStorage.get(STORAGE_KEY) : null;
    if (!rec || typeof rec !== 'object' || STATUSES.indexOf(rec.status) === -1) return blank();
    return Object.assign(blank(), rec);
  }
  function save(rec) {
    if (typeof AppStorage !== 'undefined') AppStorage.set(STORAGE_KEY, rec);
    return rec;
  }

  /* ---------- pre-sync backup history ----------
     A complete copy of the profile is taken BEFORE any synchronisation writes
     to it. The newest snapshot never overwrites the previous one — the last
     five are kept, newest first, so a bad sync is always reversible. */

  const BACKUP_KEY = 'profile_pre_sync_backup';
  const MAX_BACKUPS = 5;

  function backups() {
    const list = (typeof AppStorage !== 'undefined') ? AppStorage.get(BACKUP_KEY) : null;
    return Array.isArray(list) ? list : [];
  }

  function recordPreSyncBackup(profile, sourceFile) {
    if (!profile) return null;
    const entry = {
      profile: JSON.parse(JSON.stringify(profile)),
      timestamp: Date.now(),
      savedOn: new Date().toISOString(),
      sourceFile: (sourceFile && sourceFile.name) || null,
    };
    const list = [entry].concat(backups()).slice(0, MAX_BACKUPS);   // newest first, keep 5
    if (typeof AppStorage !== 'undefined') AppStorage.set(BACKUP_KEY, list);
    return entry;
  }

  function latestBackup() { return backups()[0] || null; }

  function status() { return load().status; }
  function statusLabel(s) { return STATUS_LABEL[s || status()] || s; }
  function data() { return load().data; }
  function isApproved() { return status() === 'approved'; }
  function clear() { save(blank()); }

  /* ---------- the parse lifecycle ---------- */

  function begin(sourceFile) {
    const rec = load();
    rec.status = 'parsing';
    rec.error = null;
    rec.errorCode = null;
    rec.sourceFile = sourceFile || rec.sourceFile;
    return save(rec);
  }

  function fail(code, message) {
    const rec = load();
    rec.status = 'failed';
    rec.errorCode = code;
    rec.error = message;
    rec.parsedAt = Date.now();
    return save(rec);
  }

  /* A PARTIAL extraction is still reviewable — that is the whole point of the
     review screen. Only a total failure lands in `failed`. */
  function complete(result, sourceFile) {
    const rec = load();
    /* snapshot the lists BEFORE anything can touch them — the earliest safe
       point, so a restore is always possible (Sprint 28 fix) */
    if (!rec.preSync && typeof Profile !== 'undefined') {
      const p = Profile.getState();
      rec.preSync = {
        certifications: JSON.parse(JSON.stringify(p.certifications || [])),
        skills: (p.skills || []).slice(),
        capturedAt: Date.now(),
      };
    }
    rec.status = 'needs_review';
    rec.data = result.data;
    rec.missing = result.missing || [];
    rec.completeness = result.completeness || 0;
    rec.error = null;
    rec.errorCode = null;
    rec.sourceFile = sourceFile || rec.sourceFile;
    rec.parsedAt = Date.now();
    rec.approvedAt = null;
    return save(rec);
  }

  /* ---------- review edits (the user correcting the parse) ---------- */

  /* set a value by path, e.g. 'personal.title' or 'contact.email' */
  function setField(path, value) {
    const rec = load();
    if (!rec.data) return null;
    const keys = String(path || '').split('.');
    let node = rec.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!node[keys[i]] || typeof node[keys[i]] !== 'object') return null;
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    if (path === 'personal.fullName') {
      const parts = clean(value).split(/\s+/);
      rec.data.personal.firstName = parts[0] || '';
      rec.data.personal.lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    }
    return save(rec).data;
  }

  function addSkill(skill) {
    const rec = load();
    const s = clean(skill);
    if (!rec.data || !s) return null;
    if (rec.data.skills.some(x => lc(x) === lc(s))) return rec.data;   // already there
    rec.data.skills.push(s);
    return save(rec).data;
  }

  function removeSkill(skill) {
    const rec = load();
    if (!rec.data) return null;
    rec.data.skills = rec.data.skills.filter(x => lc(x) !== lc(skill));
    return save(rec).data;
  }

  function setEmployment(index, patch) {
    const rec = load();
    if (!rec.data || !rec.data.employment[index]) return null;
    Object.assign(rec.data.employment[index], patch || {});
    rec.data.companies = rec.data.employment.map(r => r.company).filter(Boolean);
    rec.data.jobTitles = rec.data.employment.map(r => r.title).filter(Boolean);
    return save(rec).data;
  }

  function removeEmployment(index) {
    const rec = load();
    if (!rec.data || !rec.data.employment[index]) return null;
    rec.data.employment.splice(index, 1);
    rec.data.companies = rec.data.employment.map(r => r.company).filter(Boolean);
    rec.data.jobTitles = rec.data.employment.map(r => r.title).filter(Boolean);
    return save(rec).data;
  }

  function setCertification(index, patch) {
    const rec = load();
    if (!rec.data || !rec.data.certifications[index]) return null;
    Object.assign(rec.data.certifications[index], patch || {});
    return save(rec).data;
  }

  function addCertification(cert) {
    const rec = load();
    if (!rec.data || !cert || !clean(cert.name)) return null;
    rec.data.certifications.push({ name: clean(cert.name), issuer: clean(cert.issuer), year: clean(cert.year) });
    return save(rec).data;
  }

  function removeCertification(index) {
    const rec = load();
    if (!rec.data || !rec.data.certifications[index]) return null;
    rec.data.certifications.splice(index, 1);
    return save(rec).data;
  }

  /* ---------- the comparison shown before anything is written ---------- */

  const FIELDS = [
    { path: 'personal.firstName', label: 'First name', from: d => d.personal.firstName, to: p => p.personal.firstName },
    { path: 'personal.lastName', label: 'Last name', from: d => d.personal.lastName, to: p => p.personal.lastName },
    { path: 'personal.headline', label: 'Professional title', from: d => d.personal.title, to: p => p.personal.headline },
    { path: 'personal.summary', label: 'Summary', from: d => d.personal.summary, to: p => p.personal.summary },
    { path: 'contact.email', label: 'Email', from: d => d.contact.email, to: p => p.contact.email },
    { path: 'contact.phone', label: 'Phone', from: d => d.contact.phone, to: p => p.contact.phone },
    { path: 'contact.city', label: 'City', from: d => d.contact.city, to: p => p.contact.city },
    { path: 'contact.country', label: 'Country', from: d => d.contact.country, to: p => p.contact.country },
    { path: 'skills', label: 'Skills', from: d => d.skills, to: p => p.skills, list: true },
    { path: 'certifications', label: 'Certifications', from: d => d.certifications.map(c => c.name), to: p => (p.certifications || []).map(c => c.name), list: true },
    { path: 'employment', label: 'Current role', from: d => currentRole(d), to: p => `${p.employment.title} at ${p.employment.company}` },
    { path: 'history', label: 'Work history', from: d => d.employment.slice(1).map(r => `${r.title} at ${r.company}`), to: p => (p.history || []).map(h => `${h.title} at ${h.company}`), list: true },
    { path: 'preferences.targetRoles', label: 'Target roles', from: d => d.roleKeywords.join(', '), to: p => p.preferences.targetRoles },
  ];

  function currentRole(d) {
    const r = d.employment[0];
    return r ? `${r.title} at ${r.company}` : '';
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* Every field the parsed résumé would change, with both values side by side.
     `changed:false` rows are unchanged and need no decision. */
  function diff(profile) {
    const rec = load();
    if (!rec.data) return [];
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p) return [];
    return FIELDS.map(f => {
      const parsed = f.from(rec.data);
      const current = f.to(p);
      const empty = f.list ? !(parsed || []).length : !clean(parsed);

      /* Skills and certifications are ADDITIVE (Sprint 28 fix): the row shows
         what is already held, what the résumé turned up, and what would
         actually be added. `removed` is always empty — a sync never deletes. */
      if (f.path === 'certifications' || f.path === 'skills') {
        const additions = f.path === 'certifications'
          ? newCertifications(p.certifications || [], rec.data.certifications).map(c => c.name)
          : newSkills(p.skills || [], rec.data.skills);
        return {
          path: f.path,
          label: f.label,
          list: true,
          additive: true,
          parsed,                       // what the résumé says
          current,                      // what the profile already holds
          kept: current,                // …all of which is kept
          additions,                    // …and only these get added
          removed: [],                  // never
          changed: additions.length > 0,
          empty,
        };
      }

      return {
        path: f.path,
        label: f.label,
        list: !!f.list,
        additive: false,
        parsed,
        current,
        /* nothing extracted → nothing to apply; the profile keeps what it has */
        changed: !empty && !same(parsed, current),
        empty,
      };
    });
  }

  /* A field the user has actually made their own — a non-empty value that is
     no longer the one CareerPilot shipped with. Parsed data must never take
     one of these by default; the user has to tick it deliberately. */
  function isUserConfirmed(path, profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p || typeof ProfileStore === 'undefined') return false;
    const defaults = ProfileStore.defaults();
    const field = FIELDS.find(f => f.path === path);
    if (!field || field.list) return false;
    const current = field.to(p);
    const shipped = field.to(defaults);
    return !!clean(current) && !same(current, shipped);
  }

  /* what the review screen ticks for you: everything additive (it is safe by
     construction), plus scalar fields you have never personally set */
  function defaultSelection(profile) {
    return diff(profile)
      .filter(d => d.changed && (d.additive || !isUserConfirmed(d.path, profile)))
      .map(d => d.path);
  }

  /* the fields worth applying — what the review screen ticks by default */
  function changedPaths(profile) {
    return diff(profile).filter(d => d.changed).map(d => d.path);
  }

  /* ---------- apply: only what the user confirmed ---------- */

  function applyToProfile(paths, profile) {
    const rec = load();
    if (!rec.data) return { ok: false, error: 'There is nothing parsed to apply' };
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p) return { ok: false, error: 'The profile is not available' };

    /* Safety net (Sprint 28 fix): a FULL snapshot of the profile before this
       sync touches it, plus the lists as they were before the very first one. */
    recordPreSyncBackup(p, rec.sourceFile);
    if (!rec.preSync) {
      rec.preSync = {
        certifications: JSON.parse(JSON.stringify(p.certifications || [])),
        skills: (p.skills || []).slice(),
        capturedAt: Date.now(),
      };
      save(rec);
    }

    const chosen = Array.isArray(paths) ? paths : [];
    const d = rec.data;
    const applied = [];

    const set = (path, fn) => {
      if (chosen.indexOf(path) === -1) return;      // not confirmed → left alone
      fn();
      applied.push(path);
    };

    set('personal.firstName', () => { p.personal.firstName = d.personal.firstName; });
    set('personal.lastName', () => { p.personal.lastName = d.personal.lastName; });
    set('personal.headline', () => { p.personal.headline = d.personal.title; });
    set('personal.summary', () => { p.personal.summary = d.personal.summary; });
    set('contact.email', () => { p.contact.email = d.contact.email; });
    set('contact.phone', () => { p.contact.phone = d.contact.phone; });
    set('contact.city', () => { p.contact.city = d.contact.city; });
    set('contact.country', () => { p.contact.country = d.contact.country; });
    /* ADDITIVE (Sprint 28 fix): a parse adds what it found and keeps
       everything the user already had. A certification is never deleted
       because the parser failed to see it. */
    set('skills', () => { p.skills = mergeSkills(p.skills, d.skills); });
    set('certifications', () => { p.certifications = mergeCertifications(p.certifications, d.certifications); });
    set('employment', () => {
      const r = d.employment[0];
      if (!r) return;
      const cur = p.employment || {};
      const isSameRole = empKey(cur) === empKey(r);

      /* A different current role does not erase the old one — it is filed into
         the history, so no record the user entered is ever lost. (An untouched
         demo role is not user data and is simply superseded.) */
      if (!isSameRole && clean(cur.company) && !isShippedEmployment(cur)) {
        p.history = mergeHistory(p.history, [{
          company: cur.company, title: cur.title, location: '',
          startDate: cur.startDate || '', endDate: cur.endDate || '', current: false,
          bullets: bulletsOf(cur.highlights),
        }]);
      }

      p.employment = Object.assign({}, cur, {
        title: r.title, company: r.company,
        startDate: r.startDate || cur.startDate,
        endDate: r.current ? '' : (r.endDate || ''),
        current: !!r.current,
        /* the same role keeps every bullet it had and gains the new ones */
        highlights: mergeBullets(isSameRole ? bulletsOf(cur.highlights) : [], r.bullets).join('\n'),
      });
    });
    set('history', () => {
      /* additive: existing records are kept, parsed ones are merged in */
      p.history = mergeHistory(p.history, d.employment.slice(1));
    });
    set('preferences.targetRoles', () => { p.preferences.targetRoles = d.roleKeywords.join(', '); });

    if (typeof ProfileStore !== 'undefined') ProfileStore.save(p);

    rec.appliedFields = applied;
    save(rec);
    return { ok: true, applied, profile: p };
  }

  /* Approve the parsed data AND apply the confirmed fields in one step —
     approval is what the confirmation dialog is for. */
  function approve(paths, profile) {
    const rec = load();
    if (!rec.data) return { ok: false, error: 'There is nothing parsed to approve' };
    const res = applyToProfile(paths || [], profile);
    if (!res.ok) return res;
    const after = load();
    after.status = 'approved';
    after.approvedAt = Date.now();
    save(after);
    return { ok: true, applied: res.applied, status: 'approved' };
  }

  /* ---------- restore (Sprint 28 fix) ----------
     Anything that was in the profile before the first sync and is no longer
     there can be put back. Nothing here deletes; it only re-adds. */

  function restorableCertifications(profile) {
    const rec = load();
    const before = (rec.preSync && rec.preSync.certifications) || [];
    if (!before.length) return [];
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p) return [];
    return newCertifications(p.certifications || [], before);
  }

  function restoreCertifications(profile) {
    const p = profile || ((typeof Profile !== 'undefined') ? Profile.getState() : null);
    if (!p) return { ok: false, error: 'The profile is not available', restored: 0 };
    const missing = restorableCertifications(p);
    if (!missing.length) return { ok: true, restored: 0, certifications: p.certifications || [] };
    p.certifications = mergeCertifications(p.certifications, missing);
    if (typeof ProfileStore !== 'undefined') ProfileStore.save(p);
    return { ok: true, restored: missing.length, certifications: p.certifications };
  }

  /* back to review (e.g. the user wants to correct something after approving) */
  function reopen() {
    const rec = load();
    if (!rec.data) return null;
    rec.status = 'needs_review';
    rec.approvedAt = null;
    return save(rec);
  }

  return {
    STORAGE_KEY, STATUSES, STATUS_LABEL, FIELDS, CERT_ALIASES,
    load, save, blank, clear, status, statusLabel, data, isApproved,
    begin, fail, complete,
    setField, addSkill, removeSkill,
    setEmployment, removeEmployment,
    addCertification, setCertification, removeCertification,
    diff, changedPaths, applyToProfile, approve, reopen,
    /* Sprint 28 fix: additive merging + restore */
    certKey, sameCert, mergeCertifications, newCertifications, mergeSkills, newSkills,
    isUserConfirmed, defaultSelection,
    restorableCertifications, restoreCertifications,
    /* Sprint 28 recovery: employment merge + pre-sync backups */
    BACKUP_KEY, MAX_BACKUPS, backups, latestBackup, recordPreSyncBackup,
    empKey, bulletsOf, mergeBullets, mergeHistory, isShippedHistory, isShippedEmployment,
  };
})();
