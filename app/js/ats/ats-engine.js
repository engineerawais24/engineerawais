/* ============================================================
   CareerPilot ATS Engine — v1  (detection only).

   ONE engine that answers a single question about a job page:
   "which Applicant Tracking System is this posting hosted on?"

   Given the current page URL (and, optionally, its HTML for the
   embedded case), it returns:

       { ats, company, supported, confidence }

     ats        — canonical ATS name, e.g. "Greenhouse", or null
     company    — best-effort company slug read from the URL, or null
     supported  — true when `ats` is one CareerPilot supports
     confidence — 0..1, how sure we are of `ats`

   Scope of v1 — deliberately narrow:
     • DETECTION ONLY. No autofill, no submission, no field reading.
     • No network. The URL is parsed as a string; the HTML, when
       supplied, is matched as a string. Nothing is ever fetched.
     • Pure & side-effect free. No storage, no globals mutated, no UI.

   Supported ATSes:
     Greenhouse · Lever · Workday · SuccessFactors ·
     SmartRecruiters · Taleo · Oracle · iCIMS

   Detection layers (strongest wins, weaker ones confirm):
     1. Dedicated ATS host      — e.g. boards.greenhouse.io          (strong)
     2. Job-page path shape     — e.g. /en-US/…/job/…  (confirms #1)  (+bump)
     3. Embedded on a company's own domain, found in the page HTML
        — e.g. <div id="grnhse_app"> on acme.com/careers            (medium)
   ============================================================ */

const AtsEngine = (() => {

  /* ---------- URL parsing (never throws) ---------- */

  function parse(url) {
    const href = String(url == null ? '' : url).trim();
    let host = '', path = '/', search = '';
    const query = new Map();

    const load = u => {
      host = (u.hostname || '').toLowerCase();
      path = u.pathname || '/';
      search = u.search || '';
      u.searchParams.forEach((v, k) => { if (!query.has(k.toLowerCase())) query.set(k.toLowerCase(), v); });
    };

    try { load(new URL(href)); }
    catch (e) {
      /* tolerate a bare host with no scheme ("boards.greenhouse.io/x") */
      try { load(new URL('https://' + href.replace(/^\/+/, ''))); }
      catch (e2) { /* leave everything blank — yields Unknown */ }
    }

    return {
      href, host, path, search, query,
      hostParts: host ? host.split('.') : [],
      /* path segments keep their original case (SmartRecruiters uses
         "Ubisoft", Greenhouse uses "stripe" — both are meaningful) */
      segs: path.split('/').filter(Boolean),
    };
  }

  /* a company token is a word, not a numeric job id or empty string */
  function clean(s) {
    const t = String(s == null ? '' : s).trim().replace(/\/+$/, '');
    if (!t) return null;
    if (/^\d+$/.test(t)) return null;          // that's an id, not a company
    return t;
  }

  /* host label helpers — is this a generic ATS-owned subdomain
     (career5, performancemanager4, tbe, www…) rather than a company? */
  const GENERIC_HOST = /^(www|jobs|job|career|careers|apply|recruiting|talent|secure|external|performancemanager\d*|career\d*|pm\w*\d*|tbe|host|dc\d*|wd\d+)$/i;

  /* ---------- per-ATS detectors ----------
     Each carries:
       name   display name (also the value returned in `ats`)
       hosts  [{ re, base }]  dedicated ATS domains → base confidence
       paths  [{ re, base }]  job-page path shapes  → confirm / stand alone
       dom    [regex]         signatures found in a company page's HTML
       company(u, html)       best-effort company slug, or null            */

  const DETECTORS = [
    {
      name: 'Greenhouse',
      /* boards.greenhouse.io, job-boards.greenhouse.io, api.greenhouse.io,
         <co>.greenhouse.io */
      hosts: [{ re: /(^|\.)greenhouse\.io$/, base: 0.9 }],
      paths: [{ re: /\/jobs?\// }, { re: /\/embed\// }],
      dom: [/grnhse_app/i, /id=["']grnhse/i, /boards\.greenhouse\.io\/embed/i, /greenhouse\.io\/embed\/job_board/i],
      company(u, html, ctx) {
        /* only trust the URL path when the host IS Greenhouse's — on an
           embedded board the path is the company's own site (…/careers/) */
        if (ctx.hostHit) {
          if (u.segs[0] && u.segs[0].toLowerCase() !== 'embed') return clean(u.segs[0]);
          const forParam = u.query.get('for');            // boards…/embed/job_board?for=<co>
          if (forParam) return clean(forParam);
        }
        /* embedded case: read the board token from the widget script/query
           (…/embed/job_board/js?for=<co>) */
        let c = u.query.get('for');
        if (!c && html) {
          const m = html.match(/greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9_-]+)/i)
                 || html.match(/[?&]for=([a-z0-9_-]+)/i);
          if (m) c = m[1];
        }
        return clean(c);
      },
    },

    {
      name: 'Lever',
      /* jobs.lever.co, jobs.eu.lever.co, api.lever.co */
      hosts: [{ re: /(^|\.)lever\.co$/, base: 0.9 }],
      /* jobs.lever.co/<co>/<uuid> — the uuid is the strong job-page tell */
      paths: [{ re: /\/[a-z0-9-]+\/[0-9a-f]{8}-[0-9a-f]{4}/i }, { re: /\/[a-z0-9-]+\/apply\/?$/i }],
      dom: [/jobs\.lever\.co/i, /lever\.co\/embed/i],
      company(u, html, ctx) {
        if (ctx.hostHit && u.segs[0]) return clean(u.segs[0]);
        if (html) { const m = html.match(/jobs\.lever\.co\/([a-z0-9-]+)/i); if (m) return clean(m[1]); }
        return null;
      },
    },

    {
      name: 'Workday',
      /* <tenant>.wd<N>.myworkdayjobs.com  /  .myworkdaysite.com */
      hosts: [
        { re: /(^|\.)myworkdayjobs\.com$/, base: 0.9 },
        { re: /(^|\.)myworkdaysite\.com$/, base: 0.9 },
      ],
      paths: [{ re: /\/job\// }, { re: /\/en-[a-z]{2}\//i }],
      dom: [/myworkday(jobs|site|cdn)\.com/i, /data-automation-id=["']jobPosting/i],
      company(u, html, ctx) {
        /* the tenant subdomain is the company: nvidia.wd5.myworkdayjobs.com —
           but only when the host really is Workday's (not an embed) */
        if (!ctx.hostHit) return null;
        const t = u.hostParts[0] || '';
        return GENERIC_HOST.test(t) ? null : clean(t);
      },
    },

    {
      name: 'SuccessFactors',
      /* SAP SuccessFactors: *.successfactors.com/.eu, *.sapsf.* */
      hosts: [
        { re: /(^|\.)successfactors\.(com|eu)$/, base: 0.9 },
        { re: /(^|\.)sapsf\.(com|eu|cn)$/, base: 0.9 },
      ],
      paths: [{ re: /\/career/i }, { re: /jobsearch/i }],
      dom: [/successfactors/i, /sapsf\b/i, /BizXAccordion/i],
      company(u, html, ctx) {
        /* SF carries the company id in a query param on most career links */
        const q = u.query.get('company') || u.query.get('companyname');
        if (q) return clean(q);
        if (ctx.hostHit) {
          const t = u.hostParts[0] || '';
          if (!GENERIC_HOST.test(t)) return clean(t);
        }
        return null;
      },
    },

    {
      name: 'SmartRecruiters',
      /* jobs.smartrecruiters.com/<Company>/<id>, careers.smartrecruiters.com */
      hosts: [{ re: /(^|\.)smartrecruiters\.com$/, base: 0.9 }],
      paths: [{ re: /^\/[^/]+\/\d/ }, { re: /^\/[^/]+\/[^/]+/ }],
      dom: [/smartrecruiters\.com/i, /smartrecruiters/i],
      company(u, html, ctx) {
        if (ctx.hostHit && u.segs[0] && !GENERIC_HOST.test(u.segs[0])) return clean(u.segs[0]);
        if (html) { const m = html.match(/smartrecruiters\.com\/([A-Za-z0-9-]+)/i); if (m && !GENERIC_HOST.test(m[1])) return clean(m[1]); }
        return null;
      },
    },

    {
      name: 'Taleo',
      /* Oracle Taleo (the legacy product): <co>.taleo.net, tbe.taleo.net */
      hosts: [{ re: /(^|\.)taleo\.net$/, base: 0.9 }],
      paths: [{ re: /\/careersection\//i }, { re: /jobdetail/i }],
      dom: [/taleo\.net/i, /careersection/i],
      company(u, html, ctx) {
        if (!ctx.hostHit) return null;
        const t = u.hostParts[0] || '';
        return GENERIC_HOST.test(t) ? null : clean(t);
      },
    },

    {
      name: 'Oracle',
      /* Oracle Cloud Recruiting (ORC / Fusion HCM) — distinct from Taleo.
         The candidate-experience path is the definitive signal; the
         Fusion-apps host (*.fa.<region>.oraclecloud.com) confirms it. */
      hosts: [{ re: /\.fa\.[a-z0-9-]+\.oraclecloud\.com$/i, base: 0.6 }],
      paths: [{ re: /\/hcmui\/candidateexperience\//i, base: 0.9 }],
      dom: [/hcmui\/candidateexperience/i, /oraclecloud\.com\/hcmUI/i],
      company(u, html, ctx) { return null; },   // the pod host is opaque; ORC hides the tenant
    },

    {
      name: 'iCIMS',
      /* <co>.icims.com, careers-<co>.icims.com */
      hosts: [{ re: /(^|\.)icims\.com$/, base: 0.9 }],
      paths: [{ re: /\/jobs\/\d+/i }, { re: /\/job\b/i }],
      dom: [/icims\.com/i, /\bicims\b/i],
      company(u, html, ctx) {
        if (!ctx.hostHit) return null;
        /* first meaningful host label before "icims", minus a careers-/jobs- prefix */
        const before = u.hostParts.slice(0, Math.max(0, u.hostParts.indexOf('icims')));
        for (let label of before) {
          label = label.replace(/^(careers?|jobs?)-/i, '');
          if (label && !GENERIC_HOST.test(label)) return clean(label);
        }
        return null;
      },
    },
  ];

  /* every ATS this engine knows how to detect is one CareerPilot supports */
  const SUPPORTED = DETECTORS.map(d => d.name);

  /* below this, a match is too weak to claim — reported as Unknown */
  const MIN_CONFIDENCE = 0.3;

  const round2 = n => Math.round(n * 100) / 100;
  const UNKNOWN = () => ({ ats: null, company: null, supported: false, confidence: 0 });

  /* ---------- scoring one detector against one page ---------- */

  function score(det, u, html) {
    let conf = 0, hostHit = false, pathHit = false;

    for (const h of det.hosts || []) {
      if (h.re.test(u.host)) { conf = Math.max(conf, h.base); hostHit = true; break; }
    }
    for (const p of det.paths || []) {
      if (p.re.test(u.path)) { pathHit = true; if (p.base) conf = Math.max(conf, p.base); break; }
    }

    /* a job-page path shape confirms a dedicated host → nudge up */
    if (hostHit && pathHit) conf = Math.min(0.98, conf + 0.07);

    /* embedded on the company's own domain: the HTML carries the ATS, the
       URL does not. A medium-confidence signal on its own; a small confirm
       when the URL already pointed at the ATS. */
    let domHit = false;
    if (html && det.dom) {
      for (const d of det.dom) {
        if (d.test(html)) { domHit = true; break; }
      }
    }
    if (domHit) conf = conf ? Math.min(0.98, conf + 0.05) : 0.65;

    return { conf, matched: hostHit || pathHit || domHit, hostHit, pathHit };
  }

  /* ---------- public: detect ----------
     input: a URL string, or { url, html } (html enables embedded detection;
     `page`/`document` accepted as aliases for html). */
  function detect(input) {
    let url = input, html = '';
    if (input && typeof input === 'object') {
      url = input.url || input.href || '';
      html = input.html || input.page || input.document || '';
    }
    if (html && typeof html !== 'string') {
      /* allow a live Document/Element to be passed straight through */
      html = html.documentElement ? html.documentElement.outerHTML
           : (html.outerHTML || String(html));
    }

    const u = parse(url);
    if (!u.host && !html) return UNKNOWN();

    let best = null;
    for (const det of DETECTORS) {
      const s = score(det, u, html);
      if (!s.matched) continue;
      if (!best || s.conf > best.conf) best = { det, conf: s.conf, hostHit: s.hostHit, pathHit: s.pathHit };
    }

    if (!best || best.conf < MIN_CONFIDENCE) return UNKNOWN();

    const ctx = { hostHit: best.hostHit, pathHit: best.pathHit };
    return {
      ats: best.det.name,
      company: best.det.company(u, html, ctx) || null,
      supported: SUPPORTED.indexOf(best.det.name) !== -1,
      confidence: round2(best.conf),
    };
  }

  /* ---------- public: detectPage ----------
     Convenience for in-browser / extension use — reads the live location
     and (for embedded detection) the current document's HTML. */
  function detectPage() {
    if (typeof location === 'undefined') return UNKNOWN();
    let html = '';
    try { html = document.documentElement.outerHTML; } catch (e) { /* no DOM */ }
    return detect({ url: location.href, html });
  }

  return { detect, detectPage, SUPPORTED, MIN_CONFIDENCE };
})();

/* CommonJS export so the engine is unit-testable outside a browser too */
if (typeof module !== 'undefined' && module.exports) module.exports = AtsEngine;
