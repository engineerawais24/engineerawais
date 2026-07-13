/* ============================================================
   Sprint 28 — Real Resume Parsing and Profile Synchronization.
   Browser harness. Builds a REAL DOCX (a ZIP) and a REAL text-based
   PDF in JavaScript, so the parsers are exercised on genuine files.
   localStorage is snapshotted and restored — no user data is touched.
   ============================================================ */

(function () {

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

  /* ---------- the résumé used throughout ---------- */

  const RESUME_TEXT = [
    'Mohammad Awais',
    'Senior Cloud Engineer',
    'Karachi, Pakistan',
    'awais.real@example.com',
    '+92 300 1234567',
    '',
    'SUMMARY',
    'Cloud engineer with eight years building platform infrastructure for regulated clients.',
    '',
    'SKILLS',
    'Terraform, Kubernetes, Go, PostgreSQL, Observability',
    '',
    'EXPERIENCE',
    'Senior Cloud Engineer — Vercel — Mar 2021 - Present',
    '• Cut deployment times by 45% by rebuilding the release pipeline.',
    '• Own the platform reliability roadmap.',
    'Cloud Engineer — Systems Limited — Jun 2018 - Feb 2021',
    '• Migrated 60 production workloads to Kubernetes.',
    '',
    'CERTIFICATIONS',
    'CKA Certified Kubernetes Administrator — CNCF (2023)',
    '',
    'EDUCATION',
    'BS Software Engineering — NED University (2018)',
  ].join('\n');

  /* ---------- build a real DOCX (a ZIP) ---------- */

  const enc = s => new TextEncoder().encode(s);

  function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
  function u32(n) { return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]; }

  /* CRC-32 — the ZIP directory carries one. Our reader doesn't verify it,
     but a real DOCX has it, so we write a real one. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* entries: [{ name, data: Uint8Array, deflate?: bool }] */
  async function buildZip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = enc(e.name);
      const raw = e.data;
      const crc = crc32(raw);
      let stored = raw;
      let method = 0;
      if (e.deflate && typeof CompressionStream !== 'undefined') {
        const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        stored = new Uint8Array(await new Response(cs).arrayBuffer());
        method = 8;
      }
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
        u32(crc), u32(stored.length), u32(raw.length),
        u16(nameBytes.length), u16(0)
      );
      parts.push(new Uint8Array(local), nameBytes, stored);

      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
        u32(crc), u32(stored.length), u32(raw.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      ));
      central.push(nameBytes);
      offset += local.length + nameBytes.length + stored.length;
    }

    const cdParts = [];
    let cdSize = 0;
    central.forEach(c => {
      const b = c instanceof Uint8Array ? c : new Uint8Array(c);
      cdParts.push(b);
      cdSize += b.length;
    });
    const eocd = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(cdSize), u32(offset), u16(0)
    ));

    const all = parts.concat(cdParts, [eocd]);
    const total = all.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function makeDocx(text, opts) {
    const xml = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
      + String(text).split('\n').map(l => `<w:p><w:r><w:t xml:space="preserve">${escXml(l)}</w:t></w:r></w:p>`).join('')
      + '</w:body></w:document>';
    return buildZip([
      { name: '[Content_Types].xml', data: enc('<?xml version="1.0"?><Types/>') },
      { name: 'word/document.xml', data: enc(xml), deflate: !!(opts && opts.deflate) },
    ]);
  }

  /* ---------- build a real, text-extractable PDF ---------- */

  function makePdf(text) {
    const escPdf = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const lines = String(text).split('\n');
    const content = 'BT /F1 11 Tf 14 TL 60 780 Td\n'
      + lines.map(l => `(${escPdf(l)}) Tj 0 -14 Td`).join('\n')
      + '\nET';

    const objs = [
      '<</Type/Catalog/Pages 2 0 R>>',
      '<</Type/Pages/Kids[3 0 R]/Count 1>>',
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
      `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
      '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
      + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
      + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;

    /* a real PDF writer emits WinAnsiEncoding — em dashes and bullets are
       single bytes in 0x80–0x9F, not UTF-8 */
    const WINANSI = { '‚': 0x82, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
    const out = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) {
      const ch = pdf[i];
      const code = pdf.charCodeAt(i);
      out[i] = WINANSI[ch] != null ? WINANSI[ch] : (code < 256 ? code : 0x3f);
    }
    return out;
  }

  const rec = (kind, bytes, name) => ({ name: name || ('resume.' + kind), kind, size: bytes.length, bytes });

  function reset() {
    ParsedResume.clear();
    CoverLetter.clear();
    ApplicationPackages.clear();
    ResumeParsing.ui.selected = {};
  }

  /* the parsed data, ready to review — used by the later cases */
  async function parseDocx() {
    reset();
    const bytes = await makeDocx(RESUME_TEXT);
    const parsed = await ResumeParser.parse(rec('docx', bytes));
    assert(parsed.ok, 'the DOCX did not parse: ' + parsed.error);
    const extracted = ResumeExtractor.extract(parsed.text);
    ParsedResume.complete(extracted, { name: 'resume.docx', kind: 'docx' });
    return extracted;
  }

  const CASES = [

    ['1 · DOCX parsing', async () => {
      reset();
      /* both ZIP storage modes a real DOCX can use */
      const stored = await ResumeParser.parse(rec('docx', await makeDocx(RESUME_TEXT)));
      assert(stored.ok, 'a stored-entry DOCX failed: ' + stored.error);
      assert(stored.text.indexOf('Mohammad Awais') !== -1, 'the DOCX text was not extracted');
      assert(stored.text.indexOf('Migrated 60 production workloads to Kubernetes') !== -1, 'the bullets were lost');

      const deflated = await ResumeParser.parse(rec('docx', await makeDocx(RESUME_TEXT, { deflate: true })));
      assert(deflated.ok, 'a DEFLATE-compressed DOCX failed: ' + deflated.error);
      assert(deflated.text === stored.text, 'the compressed DOCX produced different text');

      /* paragraphs survive as lines — the extractor depends on it */
      assert(deflated.text.split('\n').length >= 15, 'the paragraph structure was lost');
      assert(/^Mohammad Awais$/m.test(deflated.text), 'the name is not on its own line');
      return `${stored.chars} chars · stored and DEFLATE entries both read · no library, no network`;
    }],

    ['2 · Extractable PDF parsing', async () => {
      reset();
      const res = await ResumeParser.parse(rec('pdf', makePdf(RESUME_TEXT)));
      assert(res.ok, 'the PDF did not parse: ' + res.error);
      assert(res.text.indexOf('Mohammad Awais') !== -1, 'the PDF text was not extracted');
      assert(res.text.indexOf('awais.real@example.com') !== -1, 'the contact details were lost');
      assert(/^SKILLS$/m.test(res.text), 'the section headings were lost');

      /* the same résumé through either format extracts the same career data */
      const fromPdf = ResumeExtractor.extract(res.text);
      const fromDocx = ResumeExtractor.extract((await ResumeParser.parse(rec('docx', await makeDocx(RESUME_TEXT)))).text);
      assert(fromPdf.data.personal.fullName === fromDocx.data.personal.fullName, 'the two formats disagree on the name');
      assert(fromPdf.data.skills.join() === fromDocx.data.skills.join(), 'the two formats disagree on the skills');
      assert(fromPdf.data.employment.length === fromDocx.data.employment.length, 'the two formats disagree on the history');

      /* an image-only PDF has no text operators — no OCR, so it is unreadable */
      const scanned = makePdf('').slice();
      const blank = await ResumeParser.parse(rec('pdf', scanned));
      assert(blank.ok === false && blank.code === 'unreadable', 'a text-free PDF should be reported as unreadable');
      assert(/OCR/i.test(blank.error), 'the explanation should say OCR is not used');
      return `${res.chars} chars · DOCX and PDF agree on the extracted data · a scanned PDF is refused, not guessed`;
    }],

    ['3 · Unsupported and empty files', async () => {
      reset();
      const img = await ResumeParser.parse({ name: 'resume.jpg', kind: 'jpg', bytes: new Uint8Array([1, 2, 3]) });
      assert(img.ok === false && img.code === 'unsupported_type', 'a JPG should be unsupported');
      assert(/DOCX and text-based PDF/i.test(img.error), 'the message should say what is supported');

      const empty = await ResumeParser.parse(rec('docx', new Uint8Array(0)));
      assert(empty.ok === false && empty.code === 'empty_file', 'an empty file should be reported: ' + empty.code);

      const nothing = await ResumeParser.parse(null);
      assert(nothing.ok === false && nothing.code === 'empty_file', 'a missing file should fail cleanly');

      /* a corrupted DOCX — bytes that are not a ZIP at all */
      const junk = await ResumeParser.parse(rec('docx', new Uint8Array([80, 75, 3, 4, 9, 9, 9, 9, 9, 9])));
      assert(junk.ok === false && junk.code === 'corrupted', 'a damaged DOCX should be reported as corrupted, got ' + junk.code);

      /* a readable file with almost no text is unreadable, not a crash */
      const tiny = await ResumeParser.parse(rec('docx', await makeDocx('Hi')));
      assert(tiny.ok === false && tiny.code === 'unreadable', 'a near-empty document should be unreadable');

      /* every failure lands in the store with an explanation to show */
      ParsedResume.fail(junk.code, junk.error);
      assert(ParsedResume.status() === 'failed', 'the failure was not recorded');
      assert(ParsedResume.load().error === junk.error, 'the explanation was not kept');
      assert(ParsedResume.statusLabel('failed') === 'Failed', 'the status label is wrong');
      return 'unsupported · empty · missing · corrupted · unreadable — all reported with an explanation, never thrown';
    }],

    ['4 · Structured profile creation', async () => {
      const e = await parseDocx();
      const d = e.data;

      assert(d.personal.fullName === 'Mohammad Awais', 'the name is wrong: ' + d.personal.fullName);
      assert(d.personal.title === 'Senior Cloud Engineer', 'the title is wrong: ' + d.personal.title);
      assert(d.contact.email === 'awais.real@example.com', 'the email is wrong: ' + d.contact.email);
      assert(/92 300 1234567/.test(d.contact.phone), 'the phone is wrong: ' + d.contact.phone);
      assert(d.contact.city === 'Karachi' && d.contact.country === 'Pakistan', 'the location is wrong: ' + d.contact.location);
      assert(/eight years/.test(d.personal.summary), 'the summary is wrong');

      assert(d.skills.join() === 'Terraform,Kubernetes,Go,PostgreSQL,Observability', 'the skills are wrong: ' + d.skills.join());
      assert(d.certifications.length === 1 && /CKA/.test(d.certifications[0].name), 'the certification is wrong');
      assert(d.certifications[0].issuer === 'CNCF' && d.certifications[0].year === '2023', 'the certification detail is wrong');
      assert(d.education.length === 1 && /Software Engineering/.test(d.education[0].degree), 'the education is wrong');

      /* employment history, with responsibilities and achievements split out */
      assert(d.employment.length === 2, 'expected 2 roles, got ' + d.employment.length);
      const first = d.employment[0];
      assert(first.title === 'Senior Cloud Engineer' && first.company === 'Vercel', 'role 1 is wrong: ' + JSON.stringify(first));
      assert(first.startDate === '2021-03' && first.current === true, 'role 1 dates are wrong');
      assert(first.achievements.some(a => /45%/.test(a)), 'the achievement was not identified');
      assert(first.responsibilities.some(r => /reliability roadmap/.test(r)), 'the responsibility was not identified');
      const second = d.employment[1];
      assert(second.company === 'Systems Limited' && second.startDate === '2018-06' && second.endDate === '2021-02',
        'role 2 is wrong: ' + JSON.stringify(second));

      assert(d.companies.join() === 'Vercel,Systems Limited', 'the companies are wrong');
      assert(d.jobTitles.length === 2, 'the job titles are wrong');
      assert(d.totalYears >= 7 && d.totalYears <= 9, 'the years of experience are wrong: ' + d.totalYears);
      assert(d.roleKeywords.length > 0, 'no target-role keywords');

      assert(e.completeness === 100, 'a complete résumé should extract fully, got ' + e.completeness);
      assert(ParsedResume.status() === 'needs_review', 'a parsed résumé should be waiting for review');

      /* a PARTIAL extraction is still reviewable */
      const partial = ResumeExtractor.extract('Jane Doe\nSolutions Architect\n\nSKILLS\nAzure, Terraform');
      assert(partial.partial === true && partial.missing.length > 0, 'a partial résumé should report what is missing');
      assert(partial.missing.indexOf('employment history') !== -1, 'the missing sections were not reported');
      assert(partial.data.skills.length === 2, 'a partial résumé should still yield what it has');
      ParsedResume.complete(partial, { name: 'partial.docx' });
      assert(ParsedResume.status() === 'needs_review', 'a partial extraction must still be reviewable');
      return `100% extracted · 2 roles · ${d.skills.length} skills · ${d.totalYears} years · partial extraction still reviewable`;
    }],

    ['5 · Review edits', async () => {
      await parseDocx();

      /* correct a field the parser got wrong */
      ParsedResume.setField('personal.title', 'Principal Cloud Engineer');
      assert(ParsedResume.data().personal.title === 'Principal Cloud Engineer', 'the field edit did not stick');
      ParsedResume.setField('personal.fullName', 'Mohammad A Awais');
      assert(ParsedResume.data().personal.lastName === 'Awais', 'the name split did not follow the edit');

      /* add and remove skills */
      ParsedResume.addSkill('Python');
      assert(ParsedResume.data().skills.indexOf('Python') !== -1, 'the skill was not added');
      ParsedResume.addSkill('python');
      assert(ParsedResume.data().skills.filter(s => /^python$/i.test(s)).length === 1, 'a duplicate skill was added');
      ParsedResume.removeSkill('Go');
      assert(ParsedResume.data().skills.indexOf('Go') === -1, 'the skill was not removed');

      /* edit and remove employment */
      ParsedResume.setEmployment(1, { company: 'Systems Ltd' });
      assert(ParsedResume.data().employment[1].company === 'Systems Ltd', 'the employment edit did not stick');
      assert(ParsedResume.data().companies.indexOf('Systems Ltd') !== -1, 'the company list did not follow the edit');

      /* certifications */
      ParsedResume.addCertification({ name: 'Terraform Associate', issuer: 'HashiCorp', year: '2025' });
      assert(ParsedResume.data().certifications.length === 2, 'the certification was not added');
      ParsedResume.setCertification(0, { year: '2024' });
      assert(ParsedResume.data().certifications[0].year === '2024', 'the certification edit did not stick');
      ParsedResume.removeCertification(1);
      assert(ParsedResume.data().certifications.length === 1, 'the certification was not removed');

      /* the edits persist and the file is never touched */
      assert(ParsedResume.load().data.personal.title === 'Principal Cloud Engineer', 'the edits were not persisted');
      assert(localStorage.getItem(MasterResume.KEY) === null, 'the uploaded master résumé was modified');
      return 'fields, skills, employment and certifications all editable · persisted · the uploaded file is untouched';
    }],

    ['6 · Approval, comparison and profile synchronization', async () => {
      await parseDocx();
      const before = JSON.parse(JSON.stringify(Profile.getState()));

      /* the comparison, before anything is written */
      const rows = ParsedResume.diff();
      assert(rows.length > 0, 'there is no comparison');
      const changed = rows.filter(r => r.changed);
      assert(changed.length > 0, 'the comparison found nothing to change');
      const skillRow = rows.find(r => r.path === 'skills');
      assert(skillRow.current.join() === before.skills.join(), 'the comparison misreports the current profile');
      assert(skillRow.parsed.indexOf('Go') !== -1, 'the comparison misreports the parsed résumé');

      /* NOTHING is written by looking at the comparison */
      assert(JSON.stringify(Profile.getState()) === JSON.stringify(before), 'the comparison changed the profile');
      assert(ParsedResume.status() === 'needs_review', 'the comparison approved the résumé by itself');

      /* approve only SOME fields — the rest keep the user's values */
      const paths = changed.map(r => r.path).filter(p => p !== 'personal.summary');
      const res = ParsedResume.approve(paths);
      assert(res.ok, 'the approval failed: ' + res.error);
      assert(ParsedResume.status() === 'approved', 'the status did not become approved');

      const p = Profile.getState();
      /* skills and certifications MERGE — the parsed ones are added, and
         everything the profile already held is kept (Sprint 28 fix) */
      ['Go', 'PostgreSQL', 'Observability'].forEach(s =>
        assert(p.skills.indexOf(s) !== -1, 'a parsed skill was not added: ' + s));
      before.skills.forEach(s =>
        assert(p.skills.indexOf(s) !== -1, 'an existing skill was deleted by the sync: ' + s));
      assert(p.employment.company === 'Vercel' && p.employment.title === 'Senior Cloud Engineer', 'the employer did not sync');
      assert(p.employment.current === true && p.employment.startDate === '2021-03', 'the employment dates did not sync');
      assert(p.history.some(h => h.company === 'Systems Limited'), 'the parsed work history was not added');
      assert(p.certifications.some(c => /CKA/.test(c.name)), 'the parsed certification was not added');
      before.certifications.forEach(c =>
        assert(p.certifications.some(x => x.name === c.name), 'an existing certification was deleted: ' + c.name));
      assert(p.contact.email === 'awais.real@example.com', 'the email did not sync');
      assert(p.personal.headline === 'Senior Cloud Engineer', 'the title did not sync');
      assert(p.preferences.targetRoles.indexOf('Cloud Engineer') !== -1, 'the target roles did not sync');

      /* the field NOT confirmed was left exactly as it was */
      assert(p.personal.summary === before.personal.summary, 'an unconfirmed field was overwritten silently');
      assert(res.applied.indexOf('personal.summary') === -1, 'an unconfirmed field was reported as applied');

      /* and it survives a refresh */
      assert(ProfileStore.load().skills.join() === p.skills.join(), 'the synced profile was not persisted');
      assert(ParsedResume.load().status === 'approved', 'the approval was not persisted');
      assert(localStorage.getItem('careerpilot_platform.' + ParsedResume.STORAGE_KEY) !== null,
        'the parsed résumé is not in the platform storage namespace');
      return `${res.applied.length} fields applied · 1 field deliberately kept · nothing written before confirmation`;
    }],

    ['7 · Source priority', async () => {
      await parseDocx();

      /* 3 — with no approved résumé, the demo history still stands in */
      assert(CareerData.hasApproved() === false, 'nothing is approved yet');
      const demo = CareerData.experience();
      assert(demo.length > 0, 'there is no fallback experience');

      ParsedResume.approve(ParsedResume.changedPaths());

      /* 1 — the confirmed profile is authoritative */
      assert(CareerData.hasApproved() === true, 'the approval was not seen');
      assert(CareerData.sourceOf('experience') === 'profile', 'the profile should be the source after a sync');
      const roles = CareerData.experience();
      assert(roles[0].company === 'Vercel', 'the experience is not the approved one: ' + roles[0].company);
      assert(!roles.some(r => /TechVantage|Netsol/.test(r.company)), 'demo companies are still in the experience');
      assert(CareerData.employer().company === 'Vercel', 'the current employer is wrong');
      assert(CareerData.certifications().some(c => /CKA/.test(c)), 'the certifications are not the approved ones');
      assert(CareerData.location() === 'Karachi', 'the location is wrong');

      /* a user edit made AFTER the sync still wins */
      Profile.getState().personal.headline = 'Head of Platform';
      assert(Profile.getState().personal.headline === 'Head of Platform', 'the user edit did not hold');
      ParsedResume.approve([]);                          // re-approve, confirming nothing
      assert(Profile.getState().personal.headline === 'Head of Platform', 'a re-approval overwrote a user edit');

      /* once approved, the demo tier is switched off entirely */
      const empty = { personal: {}, contact: {}, employment: {}, history: [], skills: [], certifications: [], preferences: {} };
      const saved = Profile.getState();
      const roles2 = CareerData.rolesFromProfile(empty);
      assert(roles2.length === 0, 'an empty profile should yield no roles of its own');
      assert(saved.employment.company === 'Vercel', 'the profile was disturbed');
      return 'profile > approved parse > demo · demo companies gone once approved · a later user edit still wins';
    }],

    ['8 · Cover letter uses the real résumé', async () => {
      await parseDocx();
      ParsedResume.approve(ParsedResume.changedPaths());

      const job = JobSchema.normalized({
        id: 'j-k8s', title: 'Senior Platform Engineer', company: 'Acme',
        source: 'LinkedIn', sourceJobId: 'k1', applyUrl: 'https://acme.example/jobs/1',
        location: 'Dubai, United Arab Emirates', workMode: 'Hybrid',
        skills: ['Kubernetes', 'Terraform', 'Observability'],
        description: 'Own the platform.', postedDate: '2026-07-09',
        salary: 160, salaryDisclosed: true, currency: 'USD',
      });

      const letter = CoverLetter.generate(job);

      /* the REAL history, employer, location, certifications and skills */
      assert(letter.text.indexOf('Vercel') !== -1, 'the letter does not use the real employer');
      assert(letter.text.indexOf('Senior Cloud Engineer') !== -1, 'the letter does not use the real job title');
      assert(letter.text.indexOf('CKA Certified Kubernetes Administrator') !== -1, 'the letter does not use the real certification');
      assert(letter.text.indexOf('Karachi') !== -1, 'the letter does not use the real location');
      assert(/Cut deployment times by 45%|Migrated 60 production workloads/.test(letter.text),
        'the letter does not cite the real achievements');

      /* NO placeholder data anywhere */
      ['TechVantage', 'Netsol', '14 PoCs delivered', 'Azure landing zones', 'internal demo platform']
        .forEach(ghost => assert(letter.text.indexOf(ghost) === -1, 'the letter still contains placeholder data: ' + ghost));

      /* the same is true of the application package built from it */
      JobsStore.setDiscovered([job]);
      Jobs.reload();
      Jobs.approve(job.id);
      const pkg = ApplicationPackages.forJob(job.id);
      assert(pkg.coverLetter.indexOf('Vercel') !== -1, 'the package letter is not the real one');
      ['TechVantage', 'Netsol', '14 PoCs delivered']
        .forEach(ghost => assert(pkg.coverLetter.indexOf(ghost) === -1, 'the package still carries placeholder data: ' + ghost));
      return 'real employer, title, certification, location and achievements · every placeholder gone';
    }],

    ['9 · Recommendation uses the approved résumé', async () => {
      await parseDocx();
      ParsedResume.approve(ParsedResume.changedPaths());

      /* the SAME engine, fed the approved data — no second recommender */
      const ctx = ResumeRecommender.context();
      assert(ctx.targetRoles.indexOf('Cloud Engineer') !== -1, 'the target roles are not the approved ones: ' + ctx.targetRoles);
      assert(ctx.certifications.some(c => /CKA/.test(c)), 'the certifications are not the approved ones');
      assert(ctx.employer === 'Vercel', 'the employer is not the approved one: ' + ctx.employer);
      assert(ctx.years >= 7 && ctx.years <= 9, 'the years of experience are not the approved ones: ' + ctx.years);
      assert(ctx.level === 'senior' || ctx.level === 'lead', 'the seniority does not reflect the real history: ' + ctx.level);

      /* a posting that names the certification the résumé actually holds */
      const job = JobSchema.normalized({
        id: 'j-cka', title: 'Senior Solutions Architect', company: 'Acme',
        source: 'LinkedIn', sourceJobId: 'c1', applyUrl: 'https://acme.example/jobs/2',
        location: 'Remote · US', workMode: 'Remote', skills: ['Kubernetes', 'Terraform'],
        description: 'Platform architecture. CKA Certified Kubernetes Administrator required.',
        postedDate: '2026-07-09',
      });
      const best = ResumeRecommender.recommend(job);
      assert(best && typeof best.confidence === 'number', 'the recommendation broke');
      assert(best.certificationsMatched.length === 1, 'the approved certification was not credited');
      assert(best.parts.certifications === ResumeRecommender.WEIGHTS.certifications,
        'a held certification should earn full marks');
      assert(/certifications held/i.test(best.reasons.join(' ')), 'the certification is not explained');

      /* the master résumé candidate now reflects the real current role */
      const master = ResumeRecommender.candidates().find(c => c.isMaster);
      assert(master.title === 'Senior Cloud Engineer', 'the master résumé does not use the parsed title: ' + master.title);
      return `target roles, certifications, employer and ${ctx.years} years all come from the approved résumé`;
    }],

    /* ============================================================
       Sprint 28 FIX — a parse must never remove a certification the user
       already had. This is the regression suite for that bug.
       ============================================================ */
    ['11 · Existing certifications are preserved', async () => {
      await parseDocx();

      /* a real profile: several certifications the user entered by hand */
      const p = Profile.getState();
      p.certifications = [
        { name: 'JNCIA-Junos', issuer: 'Juniper', year: '2022' },
        { name: 'AZ-104 Azure Administrator', issuer: 'Microsoft', year: '2024' },
        { name: 'CCNA', issuer: 'Cisco', year: '2019' },
      ];
      const mine = p.certifications.map(c => c.name);

      ParsedResume.approve(ParsedResume.defaultSelection());

      /* every one of them survives — the résumé only mentioned CKA */
      const after = Profile.getState().certifications;
      mine.forEach(name => assert(after.some(c => c.name === name),
        'an existing certification was deleted by the sync: ' + name));
      assert(after.length === 4, 'expected 3 kept + 1 added, got ' + after.length + ': ' + after.map(c => c.name).join(' | '));
      assert(after.some(c => /CKA/.test(c.name)), 'the newly parsed certification was not added');

      /* the ones the résumé never mentioned are still exactly as written */
      const jncia = after.find(c => c.name === 'JNCIA-Junos');
      assert(jncia && jncia.issuer === 'Juniper' && jncia.year === '2022', 'an existing certification was rewritten');

      /* and it survives a refresh */
      assert(ProfileStore.load().certifications.length === 4, 'the merged certifications were not persisted');
      return `3 existing kept + 1 parsed added · nothing deleted · persisted`;
    }],

    ['12 · Duplicates merge, nothing is removed', async () => {
      await parseDocx();

      /* the same certification, written three different ways */
      assert(ParsedResume.certKey('JNCIA-Junos') === ParsedResume.certKey('JNCIA Junos'),
        'a dash should not make it a different certification');
      assert(ParsedResume.sameCert('JNCIA-Junos', 'Juniper Networks Certified Associate – Junos'),
        'the expanded vendor name should match the acronym');
      assert(ParsedResume.sameCert('cka', 'CKA — Certified Kubernetes Administrator'),
        'an acronym and its expansion should match');
      assert(!ParsedResume.sameCert('JNCIA-Junos', 'CCNA'), 'two different certifications must not merge');

      /* the user's spelling is the one that is kept */
      const p = Profile.getState();
      p.certifications = [{ name: 'JNCIA-Junos', issuer: 'Juniper', year: '2022' }];
      const merged = ParsedResume.mergeCertifications(p.certifications, [
        { name: 'Juniper Networks Certified Associate – Junos', issuer: 'Juniper Networks', year: '2022' },
        { name: 'JNCIA Junos', issuer: '', year: '' },
        { name: 'CKA Certified Kubernetes Administrator', issuer: 'CNCF', year: '2023' },
      ]);
      assert(merged.length === 2, 'the duplicates were not merged: ' + merged.map(c => c.name).join(' | '));
      assert(merged[0].name === 'JNCIA-Junos', 'the user’s own spelling was not the one kept');
      assert(merged[0].issuer === 'Juniper', 'the user’s own entry was overwritten');
      assert(merged.some(c => /CKA/.test(c.name)), 'the genuinely new certification was not added');

      /* an unmatched existing certification is NEVER dropped */
      const kept = ParsedResume.mergeCertifications(
        [{ name: 'CCNA', issuer: 'Cisco', year: '2019' }],
        [{ name: 'CKA', issuer: 'CNCF', year: '2023' }]
      );
      assert(kept.length === 2 && kept.some(c => c.name === 'CCNA'),
        'an existing certification not found in the résumé was deleted');

      /* the same rule for skills */
      const skills = ParsedResume.mergeSkills(['Terraform', 'Juniper'], ['terraform', 'Go']);
      assert(skills.length === 3 && skills.indexOf('Juniper') !== -1, 'an existing skill was deleted');
      assert(skills.filter(s => /^terraform$/i.test(s)).length === 1, 'a case-only duplicate was added twice');
      return 'JNCIA-Junos = JNCIA Junos = Juniper Networks Certified Associate – Junos · the user’s spelling wins · nothing deleted';
    }],

    ['13 · The comparison never marks a removal', async () => {
      await parseDocx();
      const p = Profile.getState();
      p.certifications = [
        { name: 'JNCIA-Junos', issuer: 'Juniper', year: '2022' },
        { name: 'CCNA', issuer: 'Cisco', year: '2019' },
      ];

      const row = ParsedResume.diff().find(r => r.path === 'certifications');
      assert(row.additive === true, 'the certification row is not additive');
      assert(row.removed.length === 0, 'the comparison marked a certification for removal');
      assert(row.kept.length === 2, 'the comparison does not show the existing certifications');
      ['JNCIA-Junos', 'CCNA'].forEach(n =>
        assert(row.kept.indexOf(n) !== -1, 'an existing certification is missing from the comparison: ' + n));
      assert(row.parsed.some(n => /CKA/.test(n)), 'the newly detected certification is not shown');
      assert(row.additions.length === 1 && /CKA/.test(row.additions[0]),
        'the comparison does not show what would actually be added: ' + row.additions.join());

      /* the screen says so, and offers no removal */
      const html = ParsingView.comparison(ParsedResume.diff(), ResumeParsing.selectChanged());
      assert(html.indexOf('Will be added') !== -1, 'the screen does not show what will be added');
      assert(html.indexOf('Nothing is removed') !== -1, 'the screen does not promise that nothing is removed');
      assert(!/remove|delete/i.test(html.replace(/Nothing is removed[^<]*/g, '')), 'the screen offers a removal');
      assert(html.indexOf('JNCIA-Junos') !== -1, 'the existing certifications are not on the screen');

      /* a résumé holding nothing new leaves the row unchanged */
      const already = ParsedResume.mergeCertifications(p.certifications, []);
      assert(already.length === 2, 'merging nothing changed the list');
      return 'existing shown as kept · newly detected shown · additions shown · no removal offered anywhere';
    }],

    ['14 · Source priority and restore', async () => {
      /* the real sequence: the user already has their own profile, THEN parses */
      const p = Profile.getState();
      p.certifications = [{ name: 'JNCIA-Junos', issuer: 'Juniper', year: '2022' }];
      p.personal.headline = 'Head of Platform';       // a field the user set themselves
      await parseDocx();                              // the snapshot is taken here

      /* a user-set scalar is NOT ticked by default — parsed data cannot take it
         without being asked */
      const chosen = ParsedResume.defaultSelection();
      assert(ParsedResume.isUserConfirmed('personal.headline') === true, 'a user-edited field was not detected');
      assert(chosen.indexOf('personal.headline') === -1, 'a user-edited field was ticked for overwrite by default');
      assert(chosen.indexOf('certifications') !== -1, 'the additive certification merge should be ticked by default');

      ParsedResume.approve(chosen);
      assert(Profile.getState().personal.headline === 'Head of Platform', 'a user-edited field was overwritten');
      assert(Profile.getState().certifications.some(c => c.name === 'JNCIA-Junos'), 'the existing certification was lost');
      assert(Profile.getState().certifications.some(c => /CKA/.test(c.name)), 'the parsed certification was not added');

      /* the safety net: whatever was there before the sync can always be put back */
      const snap = ParsedResume.load().preSync;
      assert(snap && snap.certifications.length === 1, 'no pre-sync snapshot was taken');
      assert(ParsedResume.restorableCertifications().length === 0, 'nothing should be missing after an additive merge');

      /* simulate the damage the old build did, then restore from the snapshot */
      Profile.getState().certifications = [{ name: 'CKA Certified Kubernetes Administrator', issuer: 'CNCF', year: '2023' }];
      assert(ParsedResume.restorableCertifications().length === 1, 'the lost certification was not detected');
      const res = ParsedResume.restoreCertifications();
      assert(res.ok && res.restored === 1, 'the restore failed');
      assert(Profile.getState().certifications.some(c => c.name === 'JNCIA-Junos'), 'the certification was not restored');
      assert(Profile.getState().certifications.length === 2, 'the restore lost something else');
      assert(ProfileStore.load().certifications.length === 2, 'the restore was not persisted');
      return 'user-set fields are never ticked by default · pre-sync snapshot taken · a lost certification can be restored';
    }],

    /* ============================================================
       Sprint 28 RECOVERY — the sync must never destroy user data, and the
       certifications lost by the old build must be recoverable.
       ============================================================ */
    ['15 · Employment history is merged, never replaced', async () => {
      /* a REAL history the user typed themselves (not the shipped demo) */
      const p = Profile.getState();
      p.employment = {
        title: 'Network Engineer', company: 'Nayatel', startDate: '2019-01', current: true,
        highlights: 'Ran the core routing fabric.\nOwned the JNCIA migration.',
      };
      p.history = [{
        id: 'mine-1', company: 'PTCL', title: 'NOC Engineer',
        startDate: '2016-04', endDate: '2018-12', current: false,
        highlights: 'Managed the national backbone NOC.', source: 'manual',
      }];
      const mineCompanies = ['Nayatel', 'PTCL'];

      await parseDocx();
      ParsedResume.approve(ParsedResume.changedPaths());   // apply everything, worst case

      const after = Profile.getState();
      const all = [after.employment].concat(after.history);

      /* every record the user entered still exists somewhere */
      mineCompanies.forEach(c => assert(all.some(r => r.company === c),
        'an existing employment record was deleted: ' + c));
      /* …and so does every bullet */
      assert(all.some(r => /national backbone NOC/.test(r.highlights || '')), 'an existing bullet was deleted');
      assert(all.some(r => /JNCIA migration/.test(r.highlights || '')), 'a bullet of the replaced current role was lost');

      /* the parsed roles were added */
      assert(after.employment.company === 'Vercel', 'the parsed current role was not applied');
      assert(after.history.some(h => h.company === 'Systems Limited'), 'the parsed history was not added');
      /* the role the parse displaced was filed into history, not destroyed */
      assert(after.history.some(h => h.company === 'Nayatel'), 'the previous current role was not preserved');

      /* bullets merge additively on a matching record */
      const merged = ParsedResume.mergeHistory(
        [{ company: 'Vercel', title: 'Senior Cloud Engineer', startDate: '2021-03', highlights: 'A bullet only I wrote.' }],
        [{ company: 'vercel', title: 'senior cloud engineer', startDate: '2021-03', bullets: ['A bullet only I wrote.', 'A bullet only the résumé has.'] }]
      );
      assert(merged.length === 1, 'the same role was duplicated instead of matched: ' + merged.length);
      const bullets = ParsedResume.bulletsOf(merged[0].highlights);
      assert(bullets.length === 2, 'the bullets did not merge additively: ' + bullets.join(' | '));
      assert(bullets.indexOf('A bullet only I wrote.') !== -1, 'an existing bullet was dropped');
      assert(bullets.indexOf('A bullet only the résumé has.') !== -1, 'the new bullet was not added');

      /* matching is on normalized company + title + start date */
      assert(ParsedResume.empKey({ company: 'Systems Ltd.', title: 'Systems Analyst', startDate: '2019-06' })
        === ParsedResume.empKey({ company: 'systems  ltd', title: 'SYSTEMS ANALYST', startDate: '2019-06-01' }),
        'record matching is not normalized');
      return 'every existing record and bullet preserved · displaced role filed to history · bullets merge additively';
    }],

    ['16 · Scalars, backups and untouched fields', async () => {
      const p = Profile.getState();
      p.personal.headline = 'Network Engineer';        // a scalar the user set
      p.contact.city = 'Islamabad';
      const langs = JSON.stringify(p.languages);
      const auth = JSON.stringify(p.authorization);
      const links = JSON.stringify(p.links);
      const prefs = JSON.stringify({
        locations: p.preferences.locations, minSalary: p.preferences.minSalary,
        workMode: p.preferences.workMode, jobType: p.preferences.jobType,
      });

      await parseDocx();

      /* a non-empty user scalar is never ticked for overwrite by default */
      const chosen = ParsedResume.defaultSelection();
      ['personal.headline', 'contact.city'].forEach(path => {
        assert(ParsedResume.isUserConfirmed(path) === true, 'a user-set scalar was not recognised: ' + path);
        assert(chosen.indexOf(path) === -1, 'a user-set scalar was ticked for overwrite: ' + path);
      });
      assert(chosen.indexOf('skills') !== -1 && chosen.indexOf('certifications') !== -1,
        'the additive merges should be ticked by default');

      ParsedResume.approve(chosen);
      const after = Profile.getState();
      assert(after.personal.headline === 'Network Engineer', 'a user-set scalar was overwritten automatically');
      assert(after.contact.city === 'Islamabad', 'a user-set scalar was overwritten automatically');

      /* fields outside the sync are untouched */
      assert(JSON.stringify(after.languages) === langs, 'languages were modified');
      assert(JSON.stringify(after.authorization) === auth, 'authorization was modified');
      assert(JSON.stringify(after.links) === links, 'links were modified');
      assert(JSON.stringify({
        locations: after.preferences.locations, minSalary: after.preferences.minSalary,
        workMode: after.preferences.workMode, jobType: after.preferences.jobType,
      }) === prefs, 'unrelated preferences were modified');

      /* a full pre-sync backup exists, with the profile, a timestamp and the file */
      const backups = ParsedResume.backups();
      assert(backups.length >= 1, 'no pre-sync backup was written');
      const b = ParsedResume.latestBackup();
      assert(b.profile && b.timestamp && b.sourceFile, 'the backup is missing profile/timestamp/sourceFile');
      assert(b.profile.personal.headline === 'Network Engineer', 'the backup did not capture the pre-sync profile');
      assert(localStorage.getItem('careerpilot_platform.' + ParsedResume.BACKUP_KEY) !== null,
        'the backup is not under careerpilot_platform.profile_pre_sync_backup');

      /* the history keeps at most 5, newest first, and never loses the newest */
      for (let i = 0; i < 8; i++) ParsedResume.recordPreSyncBackup(Profile.getState(), { name: 'run-' + i });
      const list = ParsedResume.backups();
      assert(list.length === ParsedResume.MAX_BACKUPS && list.length === 5, 'the backup history is not capped at 5: ' + list.length);
      assert(list[0].sourceFile === 'run-7', 'the newest backup is not first');
      assert(list[0].timestamp >= list[4].timestamp, 'the backups are not newest-first');
      return 'user scalars kept · languages/authorization/links/preferences untouched · backup written · history capped at 5';
    }],

    ['17 · Certification recovery from the Résumé Library', async () => {
      /* the profile as the broken sync left it: only what the parser found */
      const p = Profile.getState();
      p.certifications = [{ name: 'CKA Certified Kubernetes Administrator', issuer: 'CNCF', year: '2023' }];

      /* a tailored variant still holds the complete list, exactly as
         TailorEngine wrote it: "Name — Issuer (Year)" */
      const docs = ResumesStore.load();
      docs.variants[0].plan = {
        company: 'Stripe', title: 'Sr Solutions Architect',
        ops: {
          certs: [
            'JNCIA-Junos — Juniper (2022)',
            'AZ-104 Azure Administrator — Microsoft (2024)',
            'CCNA — Cisco (2019)',
            'CKA — CNCF (2023)',
          ],
          skills: [], roles: [], summaryText: '', skillsFirst: false, highlights: [],
        },
        changes: [],
      };
      ResumesStore.save(docs);

      /* the preview READS only — nothing is written */
      const before = JSON.stringify(Profile.getState().certifications);
      const plan = CertRecovery.preview();
      assert(plan.available === true, 'the recovery was not offered');
      assert(plan.source.count === 4, 'the largest snapshot was not chosen: ' + plan.source.count);
      assert(JSON.stringify(Profile.getState().certifications) === before, 'the preview wrote to the profile');

      /* it lists exactly what will happen */
      assert(plan.existing.length === 1, 'the existing certifications are not listed');
      const names = plan.toRestore.map(c => c.name);
      assert(names.length === 3, 'wrong number to restore: ' + names.join(', '));
      ['JNCIA-Junos', 'AZ-104 Azure Administrator', 'CCNA'].forEach(n =>
        assert(names.indexOf(n) !== -1, 'a missing certification was not detected for restore: ' + n));
      assert(plan.duplicates.length === 1 && /CKA/.test(plan.duplicates[0].found),
        'the duplicate was not detected and skipped');
      assert(/Certified Kubernetes Administrator/.test(plan.duplicates[0].kept),
        'the duplicate did not keep the user’s own version');

      /* the issuer and year survive the round trip */
      const jncia = plan.toRestore.find(c => c.name === 'JNCIA-Junos');
      assert(jncia.issuer === 'Juniper' && jncia.year === '2022', 'the issuer/year were lost: ' + JSON.stringify(jncia));

      /* applying is additive and removes nothing */
      const res = CertRecovery.apply();
      assert(res.ok && res.restored === 3 && res.skipped === 1, 'the recovery did not apply correctly: ' + JSON.stringify(res));
      const after = Profile.getState().certifications;
      assert(after.length === 4, 'expected 1 existing + 3 restored, got ' + after.length);
      assert(after[0].name === 'CKA Certified Kubernetes Administrator', 'the existing certification was not kept as written');
      ['JNCIA-Junos', 'AZ-104 Azure Administrator', 'CCNA'].forEach(n =>
        assert(after.some(c => c.name === n), 'a certification was not restored: ' + n));
      assert(!after.some(c => c.name === 'CKA — CNCF (2023)'), 'the duplicate was added anyway');

      /* it persists, and a backup was taken first */
      assert(ProfileStore.load().certifications.length === 4, 'the recovery was not persisted');
      assert(ParsedResume.backups().some(b => b.sourceFile === 'certification recovery'),
        'no backup was taken before the recovery wrote');

      /* running it again does nothing */
      const again = CertRecovery.apply();
      assert(again.restored === 0 && Profile.getState().certifications.length === 4, 'a second run duplicated entries');
      return 'largest snapshot found (4) · 3 restored · 1 duplicate skipped · existing kept · backup taken · persisted';
    }],

    ['18 · Certification duplicate detection (PMP and friends)', async () => {
      const S = (a, b) => ParsedResume.sameCert(a, b);

      /* the reported bug: PMP written long-hand is the same certification */
      assert(S('PMP', 'Project Management Professional (PMP)'), 'PMP long-hand was not matched');
      assert(S('PMP', 'Project Management Professional'), 'the spelled-out PMP was not matched');
      assert(S('PMP®', 'PMP - Project Management Professional'), 'a trademark symbol broke the match');
      assert(S({ name: 'PMP', issuer: 'PMI', year: '2019' }, { name: 'PMP', issuer: 'PMI', year: '2023' }),
        'a different year should not make it a different certification');
      assert(S({ name: 'Project Management Professional', issuer: 'PMI' }, { name: 'PMP', issuer: 'PMI' }),
        'the same issuer with a longer name was not matched');

      /* punctuation, spacing and case */
      assert(S('JNCIA-Junos', 'jncia junos'), 'case/punctuation broke the match');
      assert(S('JNCIA-Junos', 'Juniper Networks Certified Associate – Junos'), 'the vendor long-form was not matched');
      assert(S('CKA', 'CKA — Certified Kubernetes Administrator'), 'the acronym + expansion was not matched');
      assert(S('AZ-104', 'AZ 104 Azure Administrator'), 'AZ-104 was not matched');
      assert(S('CISSP', 'Certified Information Systems Security Professional (CISSP)'), 'CISSP was not matched');

      /* and it must NOT over-merge */
      assert(!S('PMP', 'CAPM'), 'two different PMI certifications were merged');
      assert(!S('JNCIA-Junos', 'CCNA'), 'two different certifications were merged');
      assert(!S('AWS Certified Developer', 'AWS Certified Solutions Architect'),
        'two different AWS certifications were merged on a shared word');
      assert(!S('CKA', 'CKAD'), 'CKA and CKAD were merged');

      /* the recovery now files PMP under duplicates, not restore */
      const p = Profile.getState();
      p.certifications = [
        { name: 'Project Management Professional (PMP)', issuer: 'PMI', year: '2019' },
        { name: 'CKA Certified Kubernetes Administrator', issuer: 'CNCF', year: '2023' },
      ];
      const docs = ResumesStore.load();
      docs.variants[0].plan = {
        company: 'Stripe', title: 'Sr Solutions Architect',
        ops: {
          certs: [
            'PMP — PMI (2023)',                       // already held, written differently
            'CKA — CNCF (2023)',                      // already held
            'JNCIA-Junos — Juniper (2022)',           // genuinely missing
            'CCNA — Cisco (2019)',                    // genuinely missing
          ],
          skills: [], roles: [], summaryText: '', skillsFirst: false, highlights: [],
        },
        changes: [],
      };
      ResumesStore.save(docs);

      const plan = CertRecovery.preview();
      const restore = plan.toRestore.map(c => c.name);
      assert(restore.indexOf('PMP') === -1, 'PMP is STILL listed for restore');
      assert(plan.duplicates.some(d => /^PMP/.test(d.found)), 'PMP is not listed under duplicates skipped');
      assert(plan.duplicates.find(d => /^PMP/.test(d.found)).kept === 'Project Management Professional (PMP)',
        'the duplicate did not keep the user’s own version');
      assert(restore.length === 2, 'wrong restore count: ' + restore.join(', '));
      ['JNCIA-Junos', 'CCNA'].forEach(n => assert(restore.indexOf(n) !== -1, 'a genuinely missing cert was not offered: ' + n));

      /* and the preview still wrote nothing */
      assert(Profile.getState().certifications.length === 2, 'the preview wrote to the profile');
      return 'PMP → duplicates skipped · 2 genuinely missing offered · no over-merging · nothing written';
    }],

    ['19 · Labelled certifications (PCNSE)', async () => {
      const S = (a, b) => ParsedResume.sameCert(a, b);

      /* the three spellings must be one certification */
      assert(S('PCNSE', 'Security Vendors: PCNSE'), 'the labelled form was not matched');
      assert(S('PCNSE', 'Palo Alto Networks Certified Network Security Engineer'), 'the vendor long-form was not matched');
      assert(S('Security Vendors: PCNSE', 'Palo Alto Networks Certified Network Security Engineer'),
        'the labelled form and the long-form were not matched');
      assert(S('Security Vendors: PCNSE', 'PCNSE — Palo Alto Networks (2021)'), 'the issuer suffix broke the match');

      /* a heading must not merge different certifications */
      assert(!S('Security Vendors: PCNSE', 'Security Vendors: CCNA'), 'two certs under one heading were merged');
      assert(!S('AWS: Solutions Architect', 'Azure: Solutions Architect'),
        'a multi-word colon segment over-merged two different certifications');
      assert(!S('PCNSE', 'PCNSA'), 'PCNSE and PCNSA were merged');

      /* the preview files it under duplicates, and the count drops by one */
      const p = Profile.getState();
      p.certifications = [
        { name: 'Security Vendors: PCNSE', issuer: 'Palo Alto Networks', year: '2021' },
        { name: 'Project Management Professional (PMP)', issuer: 'PMI', year: '2019' },
      ];
      const docs = ResumesStore.load();
      docs.variants[0].plan = {
        company: 'Stripe', title: 'Sr Solutions Architect',
        ops: {
          certs: [
            'PCNSE — Palo Alto Networks (2021)',                     // already held (labelled)
            'Palo Alto Networks Certified Network Security Engineer — Palo Alto (2021)', // same again
            'PMP — PMI (2023)',                                      // already held
            'JNCIA-Junos — Juniper (2022)',                          // genuinely missing
          ],
          skills: [], roles: [], summaryText: '', skillsFirst: false, highlights: [],
        },
        changes: [],
      };
      ResumesStore.save(docs);

      const plan = CertRecovery.preview();
      const restore = plan.toRestore.map(c => c.name);
      assert(!restore.some(n => /pcnse|palo alto/i.test(n)), 'PCNSE is STILL listed for restore: ' + restore.join(', '));
      assert(!restore.some(n => /^PMP/.test(n)), 'PMP regressed back into restore');
      assert(plan.duplicates.some(d => /PCNSE/i.test(d.found)), 'PCNSE is not under duplicates skipped');
      assert(plan.duplicates.find(d => /PCNSE/i.test(d.found)).kept === 'Security Vendors: PCNSE',
        'the duplicate did not keep the user’s own spelling');
      assert(restore.length === 1 && restore[0] === 'JNCIA-Junos',
        'only the genuinely missing certification should remain: ' + restore.join(', '));

      /* the preview still writes nothing */
      assert(Profile.getState().certifications.length === 2, 'the preview wrote to the profile');
      return 'PCNSE (all 3 spellings) → duplicates skipped · only JNCIA-Junos left to restore · nothing written';
    }],

    ['10 · Backward compatibility', async () => {
      reset();
      /* with nothing parsed, everything behaves exactly as it did before */
      assert(ParsedResume.status() === 'not_parsed', 'the clean state is wrong');
      assert(CareerData.hasApproved() === false, 'nothing should be approved');
      const roles = CareerData.experience();
      assert(roles.length === 3 && roles[0].company === 'TechVantage Systems',
        'the existing profile-derived experience changed');

      const job = JobSchema.normalized({
        id: 'j-bc', title: 'Senior Solutions Architect', company: 'Acme',
        source: 'LinkedIn', sourceJobId: 'b1', applyUrl: 'https://acme.example/jobs/3',
        location: 'Remote · US', workMode: 'Remote', skills: ['Terraform', 'Kubernetes', 'Cloud migration'],
        description: 'x', postedDate: '2026-07-09',
      });
      const letter = CoverLetter.generate(job);
      assert(letter.text.indexOf('TechVantage Systems') !== -1, 'the pre-parse letter changed');
      assert(ResumeRecommender.recommend(job).id === 'var1', 'the résumé recommendation changed');

      /* Sprints 24–27 are intact */
      JobsStore.setDiscovered([job]);
      Jobs.reload();
      Jobs.approve(job.id);
      const pkg = ApplicationPackages.forJob(job.id);
      assert(pkg && pkg.jobSummary && pkg.matchScore != null, 'the Sprint 27 package broke');
      assert(ApplicationPackages.checklist(pkg.id).items.length === 5, 'the Sprint 27 checklist broke');
      assert(ApplicationPackages.STATUSES.length === 5, 'the Sprint 24 statuses changed');
      assert(typeof JobMatchEngine.score === 'function', 'the Sprint 25 engine changed');
      assert(typeof ImportedJobs.create === 'function', 'the Sprint 26 import broke');
      assert(Object.keys(MatchEngine.WEIGHTS).reduce((n, k) => n + MatchEngine.WEIGHTS[k], 0) === 100,
        'the original MatchEngine changed');

      /* the Résumé Library keeps its layout, with the status strip added */
      const html = Resumes.render();
      assert(html.indexOf('doc-layout') !== -1, 'the Résumé Library was redesigned');
      assert(html.indexOf('rp-strip') !== -1, 'the parsing status is not on the Résumé Library');
      assert(html.indexOf('Not parsed') !== -1, 'the parsing status is not shown');
      return 'pre-parse behaviour unchanged · Sprints 24–27 intact · the library keeps its layout';
    }],
  ];

  /* ---------- runner ---------- */

  function pinProfile() {
    const p = Profile.getState();
    const snap = JSON.parse(JSON.stringify(p));
    const d = ProfileStore.defaults();
    Object.keys(p).forEach(k => delete p[k]);
    Object.assign(p, d);
    return () => {
      Object.keys(p).forEach(k => delete p[k]);
      Object.assign(p, snap);
    };
  }

  async function run() {
    const backup = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); backup[k] = localStorage.getItem(k); }
    let restoreProfile = () => {};
    const results = [];
    try {
      ['careerpilot_jobs_v1', 'careerpilot_profile_v1', 'careerpilot_resumes_v1',
        'careerpilot_applications_v1', 'careerpilot_master_resume_v1', 'careerpilot_documents_v1',
        'careerpilot_platform.resume_overrides', 'careerpilot_platform.cover_letters',
        'careerpilot_platform.application_packages', 'careerpilot_platform.parsed_resume']
        .forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });

      for (const [name, fn] of CASES) {
        restoreProfile();                       // every case starts from the shipped profile
        restoreProfile = pinProfile();
        try { results.push({ name, pass: true, detail: (await fn()) || '' }); }
        catch (e) { results.push({ name, pass: false, detail: e.message }); }
      }
    } finally {
      restoreProfile();
      localStorage.clear();
      Object.keys(backup).forEach(k => localStorage.setItem(k, backup[k]));
    }
    return results;
  }

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function render(results) {
    const passed = results.filter(r => r.pass).length;
    const head = document.getElementById('summary');
    head.className = passed === results.length ? 'ok' : 'bad';
    head.textContent = `${passed}/${results.length} passed`;
    document.getElementById('results').innerHTML = results.map(r => `
      <div class="t ${r.pass ? 'pass' : 'fail'}">
        <span class="badge">${r.pass ? 'PASS' : 'FAIL'}</span>
        <div><b>${esc(r.name)}</b><div class="detail">${esc(r.detail)}</div></div>
      </div>`).join('');
    results.forEach(r => (r.pass ? console.log : console.error)(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`));
    console.log(`Sprint 28: ${passed}/${results.length} passed`);
  }

  window.addEventListener('load', async () => render(await run()));
})();
