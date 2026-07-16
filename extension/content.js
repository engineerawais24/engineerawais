/* ============================================================
   CareerPilot Helper — content script (injected on click).

   Two jobs, both DOM-only:
     detect   → read the job posting off the page
     autofill → fill EMPTY, VISIBLE fields from the profile

   Hard rules, enforced here:
     • a field with ANY existing value is never touched
     • hidden/disabled/readonly fields are never touched
     • nothing is ever submitted — no clicks, no form.submit()
     • no network access from this script
   ============================================================ */

(() => {
  if (window.__cpHelperLoaded) return;
  window.__cpHelperLoaded = true;

  const txt = el => (el && (el.textContent || '').replace(/\s+/g, ' ').trim()) || '';
  const first = sels => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && txt(el)) return txt(el);
    }
    return '';
  };
  const meta = name =>
    (document.querySelector(`meta[property="${name}"], meta[name="${name}"]`) || {}).content || '';

  /* ================= 1. JOB DETECTION ================= */

  const SITES = [
    {
      id: 'LinkedIn',
      match: h => /linkedin\.com$/.test(h) || h.endsWith('.linkedin.com'),
      title: ['.job-details-jobs-unified-top-card__job-title h1',
        '.job-details-jobs-unified-top-card__job-title',
        '.top-card-layout__title', 'h1.t-24', 'h1'],
      company: ['.job-details-jobs-unified-top-card__company-name a',
        '.job-details-jobs-unified-top-card__company-name',
        '.topcard__org-name-link', '.top-card-layout__second-subline a'],
      location: ['.job-details-jobs-unified-top-card__primary-description-container span.tvm__text',
        '.topcard__flavor--bullet', '.top-card__subline-item'],
    },
    {
      id: 'Bayt',
      match: h => /(^|\.)bayt\.com$/.test(h),
      title: ['h1#job_title', 'h1.h3', 'h1'],
      company: ['a.is-black[href*="/company/"]', '.toggle-head a.t-default', 'a[href*="-company-"]'],
      location: ['.t-mute[itemprop="address"]', 'span[itemprop="address"]', '.p10y .t-mute'],
    },
    {
      id: 'GulfTalent',
      match: h => /(^|\.)gulftalent\.com$/.test(h),
      title: ['h1.space-bottom-sm', 'h1[itemprop="title"]', 'h1'],
      company: ['[itemprop="hiringOrganization"]', '.company-name', 'a[href*="/company"]'],
      location: ['[itemprop="jobLocation"]', '.job-location', '.space-bottom-sm + p'],
    },
    {
      id: 'Workday',
      match: h => h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com'),
      title: ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id]', 'h1'],
      company: [],                    // Workday pages rarely name the company in the DOM
      location: ['[data-automation-id="locations"] dd', '[data-automation-id="location"]'],
      companyFromHost: h => (h.split('.')[0] || '').replace(/^wd\d+-/, ''),
    },
    {
      id: 'Greenhouse',
      match: h => /(^|\.)greenhouse\.io$/.test(h),
      title: ['.app-title', '.job__title h1', 'h1'],
      company: ['.company-name', '.job__company'],
      location: ['.location', '.job__location'],
      companyFromPath: p => (p.match(/^\/([^/]+)\/jobs?/) || [])[1] || '',
    },
    {
      id: 'Lever',
      match: h => /(^|\.)lever\.co$/.test(h),
      title: ['.posting-headline h2', 'h2'],
      company: [],
      location: ['.posting-categories .location', '.posting-category.location', '.sort-by-time.posting-category'],
      companyFromPath: p => (p.split('/')[1] || ''),
    },
  ];

  function cap(s) {
    return String(s || '').replace(/[-_]+/g, ' ').trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function detect() {
    const host = location.hostname.toLowerCase();
    const site = SITES.find(s => s.match(host));

    let title = '', company = '', loc = '', source, detectedBy;

    if (site) {
      detectedBy = source = site.id;
      title = first(site.title || []);
      company = first(site.company || []);
      loc = first(site.location || []);
      if (!company && site.companyFromHost) company = cap(site.companyFromHost(host));
      if (!company && site.companyFromPath) company = cap(site.companyFromPath(location.pathname));
    } else {
      /* generic company career page */
      detectedBy = 'generic';
      source = 'Company Careers';
      title = first(['h1[class*="job"]', 'h1[class*="title"]', '[class*="job-title"]', 'h1']);
      company = meta('og:site_name');
      loc = first(['[class*="job-location"]', '[class*="location"]', '[itemprop="jobLocation"]']);
      /* "Senior Engineer - Acme" / "Senior Engineer | Acme Careers" */
      if (!title || !company) {
        const parts = (meta('og:title') || document.title).split(/\s+[|\-–—·]\s+/);
        if (!title) title = (parts[0] || '').trim();
        if (!company) company = (parts[1] || '').replace(/careers?|jobs?/gi, '').trim();
      }
      if (!company) company = cap(host.replace(/^(www|careers|jobs|apply)\./, '').split('.')[0]);
    }

    /* an obviously non-job page yields nothing rather than garbage */
    if (title.length > 140) title = '';
    return { title, company, location: loc, url: location.href, source, detectedBy };
  }

  /* ================= 1b. LINKEDIN LIST HARVEST =================
     Read the job cards ALREADY rendered on the logged-in LinkedIn Jobs
     search page. Nothing is fetched and nothing is scraped server-side —
     this only reads the DOM the user is already looking at. It returns the
     five fields CareerPilot stores (title/company/location/url/source); the
     popup saves them and the backend rejects duplicates. */

  /* LinkedIn doubles link text into a visually-hidden span, so "Senior
     Engineer" arrives as "Senior EngineerSenior Engineer" — halve it. */
  function undouble(s) {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    if (!t) return t;
    const half = t.length / 2;
    if (t.length % 2 === 0 && t.slice(0, half) === t.slice(half)) return t.slice(0, half).trim();
    /* two identical halves, adjacent OR whitespace-separated:
       "TitleTitle" and "Title Title" (spans joined by textContent) both halve */
    const m = t.match(/^(.+?)\s*\1$/);
    return m ? m[1].trim() : t;
  }

  const firstLine = s => (s || '').split('\n').map(x => x.trim()).find(Boolean) || '';

  /* the visible parent card of a job link. The search results are a list, so
     the nearest <li> is almost always the card; failing that, climb to the
     first ancestor that actually holds more than one line of text. Structural,
     not class-based — resilient to LinkedIn's class churn. */
  function nearestCard(anchor) {
    let el = anchor;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.tagName === 'LI') return el;
      if (el.hasAttribute && (el.hasAttribute('data-occludable-job-id') || el.hasAttribute('data-job-id'))) return el;
    }
    el = anchor.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      if ((el.innerText || '').split('\n').filter(s => s.trim()).length >= 2) return el;
      el = el.parentElement;
    }
    return anchor.parentElement || anchor;
  }

  /* boilerplate that appears in a card but is never company or location */
  const CARD_NOISE = /^(easy apply|promoted|viewed|saved?|save|actively (reviewing|hiring)|be an early applicant|reposted|new|with verification|see how you compare|show more|hiring|am i a good fit\??|try premium.*|·|\+?\d+ (applicants?|connections?|school alumni|alum.*)|.*\bago\b.*|·.*)$/i;

  /* company + location, WITHOUT relying on class names: read the card's text
     lines, drop the title and the boilerplate, and take what's left. (A couple
     of known class hints are tried first only as a fast path.) */
  function extractCompanyLocation(card, title) {
    let company = undouble(firstIn(card, [
      '.job-card-container__primary-description', '.artdeco-entity-lockup__subtitle',
      '.job-card-container__company-name', '.job-card-list__company-name',
    ]));
    let location = undouble(firstIn(card, [
      '.job-card-container__metadata-item', '.artdeco-entity-lockup__caption',
      'ul.job-card-container__metadata-wrapper li',
    ]));
    if (company && location) return { company, location };

    const t = undouble(title);
    const lines = (card.innerText || '').split('\n').map(s => s.trim())
      .filter(Boolean)
      .filter(l => undouble(l) !== t && !CARD_NOISE.test(l));
    const looksLikeLocation = l =>
      /,/.test(l) || /\((remote|hybrid|on-?site)\)/i.test(l)
      || /\b(remote|hybrid|on-?site)\b/i.test(l)
      || /\b(united arab emirates|saudi arabia|uae|ksa|pakistan|india|egypt|qatar|kuwait|bahrain|oman|dubai|abu dhabi|riyadh|jeddah|karachi|cairo|remote)\b/i.test(l);

    if (!company) company = lines.find(l => !looksLikeLocation(l)) || lines[0] || '';
    if (!location) location = lines.find(l => l !== company && looksLikeLocation(l))
      || lines.filter(l => l !== company)[0] || '';
    return { company, location };
  }

  function collectLinkedIn() {
    /* the popup already refuses to invoke this off LinkedIn; only reported here */
    const onLinkedIn = /(^|\.)linkedin\.com$/.test(location.hostname.toLowerCase());

    /* ANCHOR-first, by href only — the one stable signal. Every job link on the
       search page carries either ?currentJobId=<id> (left list) or
       /jobs/view/<id> (right detail pane). No class guessing. */
    const anchors = Array.from(document.querySelectorAll(
      'a[href*="currentJobId="], a[href*="/jobs/view/"]'));

    const idOf = a => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/currentJobId=(\d+)/) || href.match(/\/jobs\/view\/(\d+)/);
      return m ? m[1] : '';
    };

    const allIds = new Set();
    anchors.forEach(a => { const id = idOf(a); if (id) allIds.add(id); });

    const seen = new Set();
    const jobs = [];

    for (const a of anchors) {
      const id = idOf(a);
      if (!id || seen.has(id)) continue;                    // dedupe by job id (#5)

      const card = nearestCard(a);
      /* the card must actually be rendered — display:none has no client rects */
      if (card.getClientRects && !card.getClientRects().length) continue;

      let title = undouble(firstLine(txt(a)) || a.getAttribute('aria-label') || '');
      if (!title || title.length > 160) continue;

      const { company, location: loc } = extractCompanyLocation(card, title);

      seen.add(id);
      jobs.push({
        title, company, location: loc,
        url: `https://www.linkedin.com/jobs/view/${id}/`,     // canonical (#3)
        source: 'LinkedIn',
      });
    }

    return {
      ok: true, onLinkedIn, jobs, count: jobs.length,
      /* temporary diagnostics for the popup */
      debug: { links: anchors.length, uniqueIds: allIds.size, parsed: jobs.length },
    };
  }

  /* first() scoped to a subtree (LinkedIn cards) — same "first non-empty" rule */
  function firstIn(root, sels) {
    for (const s of sels) {
      const el = (root || document).querySelector(s);
      if (el && txt(el)) return txt(el);
    }
    return '';
  }

  /* ================= 2. AUTOFILL ================= */

  /* everything we can learn about what a field is asking */
  function haystack(el) {
    const bits = [el.name, el.id, el.placeholder,
      el.getAttribute('aria-label'), el.getAttribute('autocomplete'),
      el.getAttribute('data-automation-id')];
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab) bits.push(txt(lab));
    }
    const wrap = el.closest('label');
    if (wrap) bits.push(txt(wrap));
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) labelled.split(/\s+/).forEach(id => {
      const n = document.getElementById(id);
      if (n) bits.push(txt(n));
    });
    /* Workday/Greenhouse wrap fields in a labelled container */
    const holder = el.closest('[data-automation-id], .field, .application-question, .form-group, li, div');
    if (holder && holder !== el.parentElement?.closest('form')) {
      const lab = holder.querySelector('label, legend, .label, [class*="label"]');
      if (lab) bits.push(txt(lab));
    }
    return bits.filter(Boolean).join(' ').toLowerCase();
  }

  function visible(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isEmpty(el) {
    if (el.tagName === 'SELECT') {
      if (el.selectedIndex <= 0) return true;
      const t = txt(el.options[el.selectedIndex]).toLowerCase();
      return el.value === '' || /^(select|choose|please|--|—|\.\.\.)/.test(t);
    }
    return String(el.value || '').trim() === '';
  }

  /* set a value the way a user would, so React/Workday notice */
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set && el.tagName !== 'SELECT') setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pickOption(sel, wanted) {
    const w = String(wanted).toLowerCase();
    const opts = Array.from(sel.options);
    /* exact → option contains value → value contains option
       ("Pakistani" must find "Pakistan", and the other way round) */
    const hit = opts.find(o => txt(o).toLowerCase() === w || o.value.toLowerCase() === w)
      || opts.find(o => txt(o).toLowerCase().includes(w))
      || opts.find(o => {
        const t = txt(o).toLowerCase();
        return t.length > 3 && w.includes(t);
      });
    if (!hit) return false;
    sel.value = hit.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function pickBoolean(sel, yes) {
    const opts = Array.from(sel.options);
    const hit = opts.find(o => (yes ? /^\s*yes\b/i : /^\s*no\b/i).test(txt(o)));
    if (!hit) return false;
    sel.value = hit.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /* ---------- short essay answers (local templates, no AI) ----------
     Built ONLY from things that are true: the user's own headline and
     summary, plus the company/title read off this very page. If the
     profile carries neither a headline nor a summary there is nothing
     honest to say, so the question is surfaced instead of answered. */

  function cap70(text) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    if (words.length <= 70) return words.join(' ');
    let cut = words.slice(0, 70).join(' ');
    const lastStop = cut.lastIndexOf('.');
    if (lastStop > 40) cut = cut.slice(0, lastStop + 1);
    return /[.!?]$/.test(cut) ? cut : cut + '.';
  }

  function firstSentence(s, maxWords = 30) {
    const one = String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0] || '';
    const words = one.split(' ');
    return words.length > maxWords ? '' : one;
  }

  function essayAnswers(p) {
    const job = detect();
    const company = job.company || 'your company';
    const title = job.title || 'this role';
    const head = (p.headline || '').trim();
    const sum = firstSentence(p.summary);
    if (!head && !sum) return null;              // nothing honest to write

    const asA = head ? ` as a ${head.toLowerCase()}` : '';
    const summarySay = sum ? ` ${sum}` : '';

    return {
      whyCompany: cap70(
        `The work ${company} is doing is exactly where I want to apply my experience${asA}.${summarySay} ` +
        `That overlap between what ${company} needs and what I do every day is why I'm applying.`),
      whyRole: cap70(
        `The ${title} position lines up directly with my background${asA}.${summarySay} ` +
        `This role is a natural next step for me, and one where I can contribute quickly.`),
      whyHire: cap70(
        `My background${asA} maps directly onto what the ${title} role calls for.${summarySay} ` +
        `I bring that experience ready to use, not to learn on the job.`),
      whatInterests: cap70(
        `What draws me to this opportunity is the fit: the ${title} role at ${company} asks for ` +
        `the work I already do${asA}.${summarySay}`),
    };
  }

  /* Ordered rules: the FIRST rule whose pattern matches wins, so the
     specific ones (first/last name) sit above the generic (full name).
     A rule may carry `el` — an extra predicate on the element itself. */
  const isTextarea = el => el.tagName === 'TEXTAREA';

  const RULES = (p, essays) => [
    /* SALARY — never filled, whatever the profile holds. Sits first so a
       compensation textarea can never fall through to an essay template. */
    { key: 'Salary / compensation', v: '',
      re: /salary|compensation|remuneration|\bctc\b|bonus|\bpackage\b|\bpay\b|\bwage/ },

    { key: 'First name', v: p.firstName, re: /first[\s_-]?name|given[\s_-]?name|\bfname\b|forename/ },
    { key: 'Last name', v: p.lastName, re: /last[\s_-]?name|sur[\s_-]?name|family[\s_-]?name|\blname\b/ },
    { key: 'Email', v: p.email, re: /e-?mail/, type: t => t === 'email' },
    { key: 'Phone', v: p.phone, re: /phone|mobile|cell|contact[\s_-]?number|tel(?!l)/, type: t => t === 'tel' },
    { key: 'LinkedIn', v: p.linkedin, re: /linked[\s_-]?in/ },
    { key: 'Full name', v: p.fullName, re: /full[\s_-]?name|your[\s_-]?name|applicant[\s_-]?name|legal[\s_-]?name|^name$|"name"|\bname\b(?!.*(user|company|file))/ },
    { key: 'City', v: p.city, re: /\bcity\b|\btown\b/ },
    { key: 'Nationality', v: p.nationality, re: /nationality|citizenship(?!.*status)/ },
    { key: 'Country', v: p.country, re: /country(?!.*code)/ },
    { key: 'Gender', v: p.gender, re: /\bgender\b|\bsex\b(?!ual)/ },
    { key: 'Marital status', v: p.maritalStatus, re: /marital[\s_-]?status|civil[\s_-]?status|\bmarital\b/ },
    { key: 'Current job title', v: p.currentTitle, re: /current.{0,12}(title|role|position)|job[\s_-]?title|designation/ },
    { key: 'Current company', v: p.currentCompany, re: /current.{0,12}(company|employer)|employer[\s_-]?name|company[\s_-]?name(?!.*previous)/ },
    { key: 'Years of experience', v: p.yearsExperience,
      re: /(years?|yrs).{0,12}experience|experience.{0,12}(years?|yrs)|total[\s_-]?experience/ },
    /* a bare "Experience" label counts only on a NUMBER input — a bare-worded
       textarea ("describe your experience…") is prose, not a number */
    { key: 'Years of experience', v: p.yearsExperience, re: /\bexperience\b/,
      el: el => (el.type || '').toLowerCase() === 'number' },
    { key: 'Notice period', v: p.noticePeriod, re: /notice[\s_-]?period|availability[\s_-]?to[\s_-]?(start|join)|when.{0,12}start/ },
    { key: 'Work authorization', v: p.workAuthorization, re: /work[\s_-]?(authori[sz]ation|permit)|authori[sz]ed[\s_-]?to[\s_-]?work|right[\s_-]?to[\s_-]?work|visa[\s_-]?status|immigration/ },
    { key: 'Sponsorship', bool: p.needsSponsorship, re: /sponsor/ },
    { key: 'Willing to relocate', bool: p.willRelocate, re: /reloc/ },

    /* ESSAYS — textareas only, and only these four question shapes.
       Anything else stays untouched and is surfaced in the popup. */
    { key: 'Why this company', v: essays && essays.whyCompany, el: isTextarea,
      re: /why.{0,40}(join|work (at|for|with|here)|(this|our) (company|organi[sz]ation)|\bus\b)/ },
    { key: 'Why this role', v: essays && essays.whyRole, el: isTextarea,
      re: /why.{0,30}interest.{0,30}(role|position|job)|why.{0,20}(this|the) (role|position)|why.{0,20}apply/ },
    { key: 'Why hire you', v: essays && essays.whyHire, el: isTextarea,
      re: /why should we hire|why.{0,20}(hire|choose) you|what makes you.{0,20}(good|right|strong) (fit|candidate)/ },
    { key: 'What interests you', v: essays && essays.whatInterests, el: isTextarea,
      re: /what interests you.{0,20}(about )?(this|the) (opportunity|role|position|job)|what.{0,15}(excites|attracts) you/ },
  ];

  /* ---------- radio groups ----------
     A radio group is one QUESTION (from the fieldset legend or the group's
     container label) with the individual radios as its OPTIONS. A group with
     any button already selected is never touched. */

  function radioGroups() {
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      const key = (r.form ? 'f' : 'd') + '::' + (r.name || r.id || '');
      if (!key.endsWith('::')) (groups.get(key) || groups.set(key, []).get(key)).push(r);
    }
    return Array.from(groups.values());
  }

  function radioQuestion(radios) {
    const fs = radios[0].closest('fieldset');
    if (fs) {
      const legend = fs.querySelector('legend');
      if (legend && txt(legend)) return txt(legend).toLowerCase();
    }
    /* the deepest ancestor containing EVERY radio in the group */
    let holder = radios[0].parentElement;
    while (holder && !radios.every(r => holder.contains(r))) holder = holder.parentElement;
    if (holder) {
      const lab = holder.querySelector('legend, .label, [class*="label"], label:not(:has(input))')
        || holder.querySelector('label');
      if (lab && txt(lab)) return txt(lab).toLowerCase();
    }
    return '';
  }

  function radioLabel(radio) {
    if (radio.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
      if (lab) return txt(lab);
    }
    const wrap = radio.closest('label');
    if (wrap) return txt(wrap);
    return radio.value || '';
  }

  function pickRadio(radios, rule) {
    let hit = null;
    if (rule.bool !== undefined && rule.bool !== null) {
      const re = rule.bool ? /^\s*yes\b/i : /^\s*no\b/i;
      hit = radios.find(r => re.test(radioLabel(r)));
    } else if (rule.v) {
      const w = String(rule.v).toLowerCase();
      hit = radios.find(r => radioLabel(r).toLowerCase() === w)
        || radios.find(r => radioLabel(r).toLowerCase().includes(w))
        || radios.find(r => {
          const t = radioLabel(r).toLowerCase();
          return t.length > 3 && w.includes(t);
        });
    }
    if (!hit || !visible(hit)) return false;
    hit.click();                              // selects the option — submits nothing
    return true;
  }

  function autofill(profile) {
    const essays = essayAnswers(profile);
    const rules = RULES(profile, essays);
    const fields = Array.from(document.querySelectorAll(
      'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])'
      + ':not([type=password]):not([type=submit]):not([type=button]), textarea, select'));

    const filled = [];
    let skipped = 0;
    const unknown = [];
    const seenUnknown = new Set();

    for (const el of fields) {
      if (!visible(el)) continue;
      const hay = haystack(el);
      if (!hay) continue;

      const rule = rules.find(r =>
        (!r.el || r.el(el))
        && (r.re.test(hay) || (r.type && r.type((el.type || '').toLowerCase()))));

      if (!rule) {
        /* an unmatched EMPTY field is a question we can't answer */
        if (isEmpty(el)) {
          const label = hay.slice(0, 90);
          if (!seenUnknown.has(label)) { seenUnknown.add(label); unknown.push(label); }
        }
        continue;
      }

      if (!isEmpty(el)) { skipped++; continue; }        // never overwrite

      let ok = false;
      if (el.tagName === 'SELECT') {
        if (rule.bool !== undefined && rule.bool !== null) ok = pickBoolean(el, rule.bool);
        else if (rule.v) ok = pickOption(el, rule.v);
      } else if (rule.v) {
        setValue(el, rule.v);
        ok = true;
      }

      if (ok) filled.push(rule.key);
      else {
        /* matched the question but we hold no answer (notice period,
           salary — never filled, an unlisted select option…) — surface it */
        const label = `${rule.key} — ${hay.slice(0, 60)}`;
        if (!seenUnknown.has(rule.key)) { seenUnknown.add(rule.key); unknown.push(label); }
      }
    }

    /* radio groups: one question each */
    for (const radios of radioGroups()) {
      if (radios.some(r => r.checked)) { skipped++; continue; }   // never overwrite
      if (!radios.some(visible)) continue;
      const question = radioQuestion(radios);
      if (!question) continue;

      const rule = rules.find(r => !r.el && r.re.test(question));
      if (!rule) {
        const label = question.slice(0, 90);
        if (!seenUnknown.has(label)) { seenUnknown.add(label); unknown.push(label); }
        continue;
      }
      if (pickRadio(radios, rule)) filled.push(rule.key);
      else if (!seenUnknown.has(rule.key)) {
        seenUnknown.add(rule.key);
        unknown.push(`${rule.key} — ${question.slice(0, 60)}`);
      }
    }

    return { filled, skipped, unknown };
  }

  /* ================= wiring ================= */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg.type === 'detect') sendResponse(detect());
      else if (msg.type === 'collectLinkedIn') sendResponse(collectLinkedIn());
      else if (msg.type === 'autofill') sendResponse(autofill(msg.profile || {}));
    } catch (e) {
      sendResponse({ error: e.message, filled: [], skipped: 0, unknown: [] });
    }
    return false;      // responses above are synchronous
  });
})();
