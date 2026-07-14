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
    const hit = opts.find(o => txt(o).toLowerCase() === w || o.value.toLowerCase() === w)
      || opts.find(o => txt(o).toLowerCase().includes(w));
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

  /* Ordered rules: the FIRST rule whose pattern matches wins, so the
     specific ones (first/last name) sit above the generic (full name). */
  const RULES = p => [
    { key: 'First name', v: p.firstName, re: /first[\s_-]?name|given[\s_-]?name|\bfname\b|forename/ },
    { key: 'Last name', v: p.lastName, re: /last[\s_-]?name|sur[\s_-]?name|family[\s_-]?name|\blname\b/ },
    { key: 'Email', v: p.email, re: /e-?mail/, type: t => t === 'email' },
    { key: 'Phone', v: p.phone, re: /phone|mobile|cell|contact[\s_-]?number|tel(?!l)/, type: t => t === 'tel' },
    { key: 'LinkedIn', v: p.linkedin, re: /linked[\s_-]?in/ },
    { key: 'Full name', v: p.fullName, re: /full[\s_-]?name|your[\s_-]?name|applicant[\s_-]?name|legal[\s_-]?name|^name$|"name"|\bname\b(?!.*(user|company|file))/ },
    { key: 'City', v: p.city, re: /\bcity\b|\btown\b/ },
    { key: 'Country', v: p.country, re: /country(?!.*code)/ },
    { key: 'Nationality', v: p.nationality, re: /nationality|citizenship(?!.*status)/ },
    { key: 'Current job title', v: p.currentTitle, re: /current.{0,12}(title|role|position)|job[\s_-]?title|designation/ },
    { key: 'Current company', v: p.currentCompany, re: /current.{0,12}(company|employer)|employer[\s_-]?name|company[\s_-]?name(?!.*previous)/ },
    { key: 'Years of experience', v: p.yearsExperience, re: /years?[\s_-]?(of)?[\s_-]?(work\s)?experience|total[\s_-]?experience|\bexperience[\s_-]?\(?years/ },
    { key: 'Notice period', v: p.noticePeriod, re: /notice[\s_-]?period|availability[\s_-]?to[\s_-]?(start|join)|when.{0,12}start/ },
    { key: 'Current salary', v: p.currentSalary, re: /current.{0,12}(salary|compensation|ctc|pay)/ },
    { key: 'Expected salary', v: p.expectedSalary, re: /expected.{0,12}(salary|compensation|pay)|desired.{0,12}(salary|compensation|pay)|salary[\s_-]?expectation/ },
    { key: 'Work authorization', v: p.workAuthorization, re: /work[\s_-]?(authori[sz]ation|permit)|authori[sz]ed[\s_-]?to[\s_-]?work|right[\s_-]?to[\s_-]?work|visa[\s_-]?status|immigration/ },
    { key: 'Sponsorship', bool: p.needsSponsorship, re: /sponsor/ },
    { key: 'Willing to relocate', bool: p.willRelocate, re: /reloc/ },
  ];

  function autofill(profile) {
    const rules = RULES(profile);
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
        r.re.test(hay) || (r.type && r.type((el.type || '').toLowerCase())));

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
           current salary, an unlisted select option…) — surface it */
        const label = `${rule.key} — ${hay.slice(0, 60)}`;
        if (!seenUnknown.has(rule.key)) { seenUnknown.add(rule.key); unknown.push(label); }
      }
    }

    return { filled, skipped, unknown };
  }

  /* ================= wiring ================= */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (msg.type === 'detect') sendResponse(detect());
      else if (msg.type === 'autofill') sendResponse(autofill(msg.profile || {}));
    } catch (e) {
      sendResponse({ error: e.message, filled: [], skipped: 0, unknown: [] });
    }
    return false;      // responses above are synchronous
  });
})();
