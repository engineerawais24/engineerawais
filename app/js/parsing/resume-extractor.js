/* ============================================================
   ResumeExtractor — résumé text → structured career data
   (Sprint 28).

   Deterministic, rule-based extraction. No AI, no network. Every
   value it returns is a span of the user's own text; nothing is
   inferred, embellished or invented. What it cannot find, it leaves
   empty and reports as missing — a partial extraction is still
   reviewable, which is the point: the user corrects it on the review
   screen before anything touches the profile.
   ============================================================ */

const ResumeExtractor = (() => {

  const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const lc = s => String(s == null ? '' : s).toLowerCase();

  /* ---------- section headings ---------- */
  const SECTIONS = [
    { id: 'summary', re: /^(professional\s+)?(summary|profile|objective|about( me)?)\s*:?\s*$/i },
    { id: 'skills', re: /^(technical\s+|core\s+)?(skills|competencies|technologies|expertise)\s*:?\s*$/i },
    { id: 'experience', re: /^((work|professional|employment)\s+)?(experience|history|employment)\s*:?\s*$/i },
    { id: 'education', re: /^education( (and|&) training)?\s*:?\s*$/i },
    { id: 'certifications', re: /^(certifications?|certificates?|licen[cs]es?)\s*:?\s*$/i },
    { id: 'projects', re: /^(projects|portfolio)\s*:?\s*$/i },
    { id: 'languages', re: /^languages\s*:?\s*$/i },
  ];

  function sectionOf(line) {
    const l = clean(line);
    if (!l || l.length > 40) return null;
    const hit = SECTIONS.find(s => s.re.test(l));
    return hit ? hit.id : null;
  }

  /* split the résumé into { head, summary, skills, experience, … } */
  function split(text) {
    const lines = String(text || '').split('\n').map(l => l.replace(/\t/g, ' ').trimEnd());
    const out = { head: [] };
    let current = 'head';
    lines.forEach(line => {
      const s = sectionOf(line);
      if (s) { current = s; out[current] = out[current] || []; return; }
      (out[current] = out[current] || []).push(line);
    });
    Object.keys(out).forEach(k => { out[k] = out[k].filter(l => l.trim()); });
    return out;
  }

  /* ---------- contact details ---------- */

  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
  const TITLE_RE = /(engineer|architect|consultant|developer|analyst|manager|specialist|designer|scientist|administrator|lead|director)/i;

  function looksLikeName(line) {
    const l = clean(line);
    if (!l || l.length > 45) return false;
    if (EMAIL_RE.test(l) || /\d/.test(l) || l.indexOf('@') !== -1) return false;
    if (TITLE_RE.test(l)) return false;                       // that's the title line
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) return false;
    return words.every(w => /^[A-Z][A-Za-z'’.-]*$/.test(w) || /^[A-Z.]+$/.test(w));
  }

  function extractContact(head, whole) {
    const emailM = whole.match(EMAIL_RE);
    const phoneM = whole.match(PHONE_RE);

    let fullName = '';
    let title = '';
    let location = '';

    head.forEach(line => {
      const l = clean(line);
      if (!fullName && looksLikeName(l)) { fullName = l; return; }
      if (!title && TITLE_RE.test(l) && l.length < 60 && !EMAIL_RE.test(l)) { title = l; return; }
    });

    /* a location line: "City, Country" with no digits and no @ */
    head.forEach(line => {
      const l = clean(line);
      if (location || !l || l === fullName || l === title) return;
      if (EMAIL_RE.test(l) || /\d/.test(l)) return;
      const parts = l.split(/[,|·•]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.length <= 3 && parts.every(p => p.length < 30 && /^[A-Za-z .'’-]+$/.test(p))) {
        location = parts.slice(0, 2).join(', ');
      }
    });

    const [city, country] = location ? location.split(',').map(s => s.trim()) : ['', ''];
    const names = fullName ? fullName.split(/\s+/) : [];
    return {
      fullName,
      firstName: names[0] || '',
      lastName: names.length > 1 ? names[names.length - 1] : '',
      title,
      email: emailM ? emailM[0] : '',
      phone: phoneM ? clean(phoneM[0]) : '',
      location,
      city: city || '',
      country: country || '',
    };
  }

  /* ---------- skills ---------- */

  function extractSkills(section) {
    const out = [];
    (section || []).forEach(line => {
      clean(line)
        .replace(/^[•\-*·]\s*/, '')
        .split(/[,;|·•]|\s{2,}/)
        .map(s => s.trim().replace(/\.$/, ''))
        .filter(s => s && s.length > 1 && s.length < 40 && !/^(and|the)$/i.test(s))
        .forEach(s => { if (!out.some(x => lc(x) === lc(s))) out.push(s); });
    });
    return out;
  }

  /* ---------- certifications ---------- */

  const YEAR_RE = /\b(19|20)\d{2}\b/;

  function extractCertifications(section) {
    return (section || []).map(line => {
      const l = clean(line).replace(/^[•\-*·]\s*/, '');
      if (!l) return null;
      const year = (l.match(YEAR_RE) || [''])[0];
      /* "AZ-104 Azure Administrator — Microsoft (2024)" */
      const parts = l.split(/[—–|,(]/).map(s => s.trim().replace(/\)$/, '')).filter(Boolean);
      const name = parts[0] || l;
      const issuer = parts.length > 1 && !YEAR_RE.test(parts[1]) ? parts[1] : '';
      return name ? { name, issuer, year } : null;
    }).filter(Boolean);
  }

  /* ---------- education ---------- */

  function extractEducation(section) {
    return (section || []).map(line => {
      const l = clean(line).replace(/^[•\-*·]\s*/, '');
      if (!l) return null;
      const year = (l.match(YEAR_RE) || [''])[0];
      const parts = l.split(/[—–|,]/).map(s => s.trim()).filter(Boolean);
      return { degree: parts[0] || l, school: parts[1] || '', year };
    }).filter(Boolean);
  }

  /* ---------- employment history ---------- */

  const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const DATE_RANGE_RE = new RegExp(
    '((?:' + MONTHS + ')[a-z]*\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4})'
    + '\\s*(?:—|–|-|to|until)\\s*'
    + '((?:' + MONTHS + ')[a-z]*\\.?\\s*\\d{4}|\\d{1,2}/\\d{4}|\\d{4}|present|current|now)', 'i');

  const MONTH_INDEX = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

  /* "Mar 2021" / "03/2021" / "2021" → "2021-03" (the shape the Profile uses) */
  function toMonth(s) {
    const v = clean(s).toLowerCase();
    if (!v || /present|current|now/.test(v)) return '';
    let m = v.match(new RegExp('(' + MONTHS + ')[a-z]*\\.?\\s*((?:19|20)\\d{2})'));
    if (m) return `${m[2]}-${MONTH_INDEX[m[1]]}`;
    m = v.match(/(\d{1,2})\/((?:19|20)\d{2})/);
    if (m) return `${m[2]}-${String(m[1]).padStart(2, '0')}`;
    m = v.match(/(19|20)\d{2}/);
    return m ? `${m[0]}-01` : '';
  }

  const BULLET_RE = /^[•\-*·▪]\s+/;
  /* a metric in a bullet is what makes it an achievement rather than a duty */
  const ACHIEVEMENT_RE = /\d+\s*%|\d+\s*(x|×)\b|\$\s*\d|\b\d{2,}\b|reduced|increased|cut|saved|delivered|converted|grew|improved/i;

  function extractEmployment(section) {
    const lines = (section || []).slice();
    const roles = [];
    let current = null;

    lines.forEach(raw => {
      const line = clean(raw);
      if (!line) return;

      const isBullet = BULLET_RE.test(raw.trim());
      const dates = line.match(DATE_RANGE_RE);

      /* a header line starts a role: it carries a date range, or it is a
         "Title — Company" line while we are between roles */
      const headerish = !isBullet && (dates || /[—–|]|\bat\b/i.test(line)) && line.length < 120;

      if (headerish && (dates || !current || (current && current.bullets.length))) {
        const withoutDates = dates ? line.replace(dates[0], '').replace(/[(),]\s*$/, '').trim() : line;
        const parts = withoutDates.split(/\s+[—–|]\s+|\s+\bat\b\s+|\s*,\s*/i)
          .map(s => s.trim().replace(/[—–|,]$/, '').trim())
          .filter(Boolean);

        current = {
          title: parts[0] || '',
          company: parts[1] || '',
          location: parts[2] || '',
          startDate: dates ? toMonth(dates[1]) : '',
          endDate: dates ? toMonth(dates[2]) : '',
          current: dates ? /present|current|now/i.test(dates[2]) : false,
          bullets: [],
          responsibilities: [],
          achievements: [],
        };
        roles.push(current);
        return;
      }

      if (current) {
        const text = line.replace(BULLET_RE, '').trim();
        if (!text) return;
        current.bullets.push(text);
        if (ACHIEVEMENT_RE.test(text)) current.achievements.push(text);
        else current.responsibilities.push(text);
      }
    });

    /* a role with neither a title nor a company is noise */
    return roles.filter(r => r.title || r.company);
  }

  /* total years, from the earliest start to the latest end (or today) */
  function totalYears(roles) {
    const starts = roles.map(r => r.startDate).filter(Boolean).sort();
    if (!starts.length) return null;
    const first = new Date(starts[0] + '-01T00:00:00');
    if (isNaN(first)) return null;
    const ends = roles.map(r => (r.current ? '' : r.endDate)).filter(Boolean).sort();
    const last = roles.some(r => r.current) || !ends.length
      ? new Date()
      : new Date(ends[ends.length - 1] + '-01T00:00:00');
    const years = (last - first) / (365.25 * 24 * 3600 * 1000);
    return years > 0 ? Math.round(years * 10) / 10 : null;
  }

  /* the role keywords worth targeting: the headline plus the titles held */
  function roleKeywords(contact, roles) {
    const out = [];
    const add = t => {
      const v = clean(t);
      if (v && !out.some(x => lc(x) === lc(v))) out.push(v);
    };
    add(contact.title);
    roles.forEach(r => add(r.title));
    return out.slice(0, 5);
  }

  /* ---------- the structured résumé profile ---------- */

  function extract(text) {
    const whole = String(text || '');
    const s = split(whole);

    const contact = extractContact(s.head || [], whole);
    const employment = extractEmployment(s.experience || []);
    const skills = extractSkills(s.skills || []);
    const certifications = extractCertifications(s.certifications || []);
    const education = extractEducation(s.education || []);
    const summary = clean((s.summary || []).join(' '));
    const years = totalYears(employment);

    const data = {
      personal: {
        fullName: contact.fullName,
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title,
        summary,
      },
      contact: {
        email: contact.email,
        phone: contact.phone,
        location: contact.location,
        city: contact.city,
        country: contact.country,
      },
      skills,
      certifications,
      employment,                       // work history, newest first as written
      education,
      totalYears: years,
      roleKeywords: roleKeywords(contact, employment),
      companies: employment.map(r => r.company).filter(Boolean),
      jobTitles: employment.map(r => r.title).filter(Boolean),
    };

    /* what we could NOT find — the review screen shows this honestly */
    const missing = [];
    if (!data.personal.fullName) missing.push('full name');
    if (!data.personal.title) missing.push('professional title');
    if (!data.contact.email) missing.push('email');
    if (!data.contact.phone) missing.push('phone');
    if (!data.contact.location) missing.push('location');
    if (!data.personal.summary) missing.push('summary');
    if (!data.skills.length) missing.push('skills');
    if (!data.certifications.length) missing.push('certifications');
    if (!data.employment.length) missing.push('employment history');
    if (!data.education.length) missing.push('education');
    if (data.totalYears == null) missing.push('years of experience');

    const found = 11 - missing.length;
    return {
      data,
      missing,
      completeness: Math.round((found / 11) * 100),
      partial: missing.length > 0,
    };
  }

  return {
    SECTIONS, extract, split, sectionOf,
    extractContact, extractSkills, extractCertifications, extractEducation, extractEmployment,
    totalYears, roleKeywords, toMonth, looksLikeName,
  };
})();
