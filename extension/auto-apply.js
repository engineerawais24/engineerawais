/* ============================================================
   AutoApply — Queue → ATS Auto Autofill v1 (content script).

   Runs on the 8 supported ATS hosts. When CareerPilot's Application Queue
   opens a job in a new tab, it leaves a one-shot "intent" in
   chrome.storage.local (via the bridge on the CareerPilot page). This script
   picks up that intent for THIS url, waits for the application form, and runs
   the EXISTING Universal Autofill v2 (content.js `window.__cpHelper.autofill`)
   exactly once.

   It ONLY ever acts when the page was opened from the Queue (a matching,
   unconsumed, recent intent). A page you open yourself has no intent, so
   nothing auto-runs and the manual "Autofill Application" button is unchanged.

   Guarantees (most inherited from Autofill v2):
     • never submits · never fills salary · never overwrites a user's answer ·
       never auto-accepts consent/privacy/terms/marketing checkboxes
     • login / CAPTCHA / blocked page / no application form → does NOTHING and
       surfaces "Needs Attention" back to the Queue
     • runs at most once per intent — the intent is consumed and a done-token
       is recorded, so a refresh or SPA navigation cannot autofill twice
   ============================================================ */

const AutoApply = (() => {

  const PENDING_KEY = 'cp_queue_pending';     // { url, token, jobId, ts }
  const DATA_KEY    = 'cp_autofill_data';     // { profile, resume, ts }
  const DONE_KEY    = 'cp_autofill_done';     // { token: ts, … } (capped)
  const ATTN_KEY    = 'cp_needs_attention';   // { token, url, reason, ts }
  const RESULT_KEY  = 'cp_autofill_result';   // { token, url, filled, unknown, ts }
  const STATUS_KEY  = 'cp_autofill_status';   // { stage, ats, url, filled, reason, ts } — the popup's live diagnostic
  const RESUME_KEY  = 'cp_default_resume';    // { name, mime, dataUrl } — the popup's saved default résumé
  const RESUME_DIAG_KEY = 'cp_resume_diag';   // { resumeFound, resumeInputFound, fileAssigned, filenameConfirmed, name, ts }

  /* the diagnostic stages the popup renders (temporary, for the smoke test) */
  const STAGE = {
    NO_INTENT: 'no-intent',            // ran on this page, but it wasn't opened from the Queue
    ATS_DETECTED: 'ats-detected',      // matched intent + detected the ATS
    STARTED: 'autofill-started',       // form ready, profile in hand, filling now
    COMPLETED: 'autofill-completed',   // filled N fields (done)
    ATTENTION: 'needs-attention',      // login / CAPTCHA / blocked / no-form / no-profile / …
  };

  const INTENT_MAX_AGE = 3 * 60 * 1000;       // an intent older than 3 min is stale
  const FORM_TIMEOUT   = 12 * 1000;           // wait up to 12s for the form
  const FORM_INTERVAL  = 400;

  /* ---------- storage (defaults to the SafeStorage wrapper) ---------- */
  function defaultStorage() {
    if (typeof SafeStorage !== 'undefined') return { get: SafeStorage.get, set: SafeStorage.set };
    return { get: () => Promise.resolve(null), set: () => Promise.resolve({ ok: false }) };
  }

  /* ---------- url helpers ---------- */
  const canon = u => String(u || '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  function host(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } }

  /* Fold a hostname to a canonical form so a provider's own redirect between two
     of its board hosts doesn't strand the intent. Greenhouse renamed its hosted
     boards from boards.greenhouse.io to job-boards.greenhouse.io and 301-redirects
     between them, so a job opened via one host lands on the other — the queue
     stores boards.greenhouse.io (what the Job Board API returns) while the tab
     ends up on job-boards.greenhouse.io. Both fold to boards.greenhouse.io. */
  function normHost(h) {
    h = String(h || '').toLowerCase();
    return /(^|\.)greenhouse\.io$/.test(h) ? h.replace(/^job-/, '') : h;
  }

  /* is this page the one the Queue opened? (exact URL, or same host after a
     locale/provider redirect — incl. Greenhouse's boards ⇄ job-boards rename),
     recent, and carrying a token */
  function matchIntent(pending, loc, now, maxAge) {
    if (!pending || !pending.url || !pending.token) return false;
    if (now - (pending.ts || 0) > (maxAge || INTENT_MAX_AGE)) return false;
    const here = (loc && loc.href) || '';
    if (canon(here) === canon(pending.url)) return true;
    const hh = host(here);
    return !!hh && normHost(hh) === normHost(host(pending.url));
  }

  /* ---------- page inspection (pure, testable) ---------- */

  /* enough real, fillable fields to call this an application form */
  function hasApplicationForm(doc) {
    if (!doc || !doc.querySelectorAll) return false;
    const fields = doc.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=password]), textarea, select');
    let usable = 0;
    fields.forEach(el => {
      const st = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null;
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return;
      usable++;
    });
    const fileUpload = !!doc.querySelector('input[type=file]');
    return usable >= 2 || fileUpload;                 // a résumé upload alone also counts
  }

  function pageText(doc) {
    const body = (doc && doc.body && doc.body.innerText) || '';
    const title = (doc && doc.title) || '';
    return (body.slice(0, 6000) + ' ' + title).toLowerCase();
  }

  /* login wall / CAPTCHA / hard-blocked page → a reason string, else null */
  function detectBlocker(doc, loc) {
    if (!doc || !doc.querySelector) return 'blocked';
    const t = pageText(doc);
    const url = ((loc && loc.href) || '').toLowerCase();

    if (doc.querySelector('.g-recaptcha, [data-sitekey], #captcha, [id*="captcha" i], [class*="captcha" i], iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i]')
        || /\brecaptcha\b|\bhcaptcha\b|verify you are human|i'm not a robot/.test(t)) return 'captcha';

    if (/access denied|access to this page has been denied|you (have been|are) blocked|are you a (human|robot)|just a moment\.\.\.|attention required|request blocked|forbidden|error 403|cloudflare/i.test(t)) return 'blocked';

    const hasPassword = !!doc.querySelector('input[type=password]');
    const signin = /sign in|log in|\blogin\b|sign into your account|create an account|forgot (your )?password/.test(t)
      || /\/(login|signin|sign-in|auth|account\/login|sso)\b/.test(url);
    if (hasPassword && signin && !hasApplicationForm(doc)) return 'login';

    return null;
  }

  /* ---------- default async form wait (production) ---------- */
  function waitForForm(doc, opts) {
    const o = opts || {};
    const timeout = o.timeout || FORM_TIMEOUT;
    const interval = o.interval || FORM_INTERVAL;
    return new Promise(resolve => {
      if (hasApplicationForm(doc)) { resolve(true); return; }     // often ready already
      const started = Date.now();
      const timer = setInterval(() => {
        if (hasApplicationForm(doc)) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started >= timeout) { clearInterval(timer); resolve(false); }
      }, interval);
    });
  }

  /* ---------- wait for the DOM to settle after a re-render ----------
     Resolves once no mutations have landed for `quiet` ms (the form has stopped
     re-rendering), or after `timeout` ms as a hard stop. Used between attaching
     the résumé (which can trigger a Greenhouse/React re-render) and filling the
     text fields, so the fields we set are the ones that survive. */
  function waitStable(doc, opts) {
    const o = opts || {};
    const quiet = o.quiet || 400;
    const timeout = o.timeout || 3000;
    return new Promise(resolve => {
      if (!doc || !doc.body || typeof MutationObserver === 'undefined') { resolve(false); return; }
      let quietTimer, hardTimer, done = false, obs;
      const finish = v => { if (done) return; done = true; try { obs && obs.disconnect(); } catch (e) {} clearTimeout(quietTimer); clearTimeout(hardTimer); resolve(v); };
      try {
        obs = new MutationObserver(() => { clearTimeout(quietTimer); quietTimer = setTimeout(() => finish(true), quiet); });
        obs.observe(doc.body, { childList: true, subtree: true, attributes: true });
      } catch (e) { resolve(false); return; }
      quietTimer = setTimeout(() => finish(true), quiet);      // already quiet → resolve after one window
      hardTimer = setTimeout(() => finish(false), timeout);
    });
  }

  function trimDone(done, keep) {
    const entries = Object.entries(done || {}).sort((a, b) => b[1] - a[1]).slice(0, keep || 50);
    const out = {}; entries.forEach(([k, v]) => { out[k] = v; }); return out;
  }

  /* ---------- the orchestrator ---------- */
  async function run(env) {
    env = env || {};
    const loc = env.loc || (typeof location !== 'undefined' ? location : { href: '', hostname: '' });
    const doc = env.doc || (typeof document !== 'undefined' ? document : null);
    const storage = env.storage || defaultStorage();
    const atsOf = env.ats || (typeof AtsEngine !== 'undefined' ? AtsEngine : null);
    const autofill = env.autofill || (typeof window !== 'undefined' && window.__cpHelper && window.__cpHelper.autofill) || null;
    const attachResume = env.attachResume || (typeof window !== 'undefined' && window.__cpHelper && window.__cpHelper.attachResume) || null;
    const now = env.now || Date.now();
    const wait = env.waitForForm || waitForForm;

    const htmlOf = () => (doc && doc.documentElement ? doc.documentElement.outerHTML : '');
    /* write the popup's live diagnostic status (best-effort; never throws) */
    const report = (stage, extra) =>
      storage.set(STATUS_KEY, Object.assign(
        { stage, url: (loc && loc.href) || '', ats: null, ts: now }, extra || {}));

    /* 1 — only act on a matching, unconsumed, recent Queue intent.
       A hand-opened page has no intent → we record a "no-intent" diagnostic
       (so the popup can explain why) and do NOT autofill. */
    const pending = await storage.get(PENDING_KEY);
    if (!matchIntent(pending, loc, now, env.maxAge)) {
      let ats = null;
      try { if (atsOf) ats = atsOf.detect({ url: loc.href, html: htmlOf() }).ats; } catch (e) { /* best-effort */ }
      await report(STAGE.NO_INTENT, { ats });
      return { ran: false, reason: 'not-queue-opened' };
    }

    /* 2 — run-once guard */
    const done = (await storage.get(DONE_KEY)) || {};
    if (done[pending.token]) return { ran: false, reason: 'already-done' };

    /* 3 — consume the intent + record the token up front, so a refresh or a
       second frame can never re-fire this same auto-apply */
    await storage.set(PENDING_KEY, null);
    done[pending.token] = now;
    await storage.set(DONE_KEY, trimDone(done));

    const ctx = { storage, pending, now, loc };

    /* 4 — fast fail on an obvious login / CAPTCHA / blocked page */
    const early = detectBlocker(doc, loc);
    if (early) return attention(ctx, early);

    /* 5 — detect the ATS (recorded; the form is the real gate) */
    let detection = { ats: null, supported: false, confidence: 0 };
    try {
      if (atsOf) detection = atsOf.detect({ url: loc.href, html: htmlOf() });
    } catch (e) { /* detection is best-effort */ }
    await report(STAGE.ATS_DETECTED, { token: pending.token, jobId: pending.jobId, ats: detection.ats });

    /* 6 — wait for the application form to be ready */
    const ready = await wait(doc, { timeout: env.formTimeout, interval: env.formInterval });
    if (!ready) return attention(ctx, detectBlocker(doc, loc) || 'no-form', detection);

    /* a CAPTCHA/login can appear over a form after load — re-check */
    const late = detectBlocker(doc, loc);
    if (late) return attention(ctx, late, detection);

    /* 7 — the profile + résumé the Queue handed us */
    const data = env.data || (await storage.get(DATA_KEY));
    const profile = data && data.profile;
    if (!profile || (!profile.fullName && !profile.email)) return attention(ctx, 'no-profile', detection);

    /* 8 — résumé source of truth: ONLY the popup's default résumé in
       chrome.storage.local (cp_default_resume). The queue intent must NOT carry a
       résumé binary, and any stale copy inside `data` is ignored on purpose — so
       a résumé the user replaced can never be re-attached from an old intent. */
    const resume = await storage.get(RESUME_KEY);
    const haveResume = !!(resume && resume.dataUrl);

    if (typeof autofill !== 'function') return attention(ctx, 'no-engine', detection);
    await report(STAGE.STARTED, { token: pending.token, jobId: pending.jobId, ats: detection.ats });

    /* the dropzone drop strategy is enabled ONLY on Greenhouse's board hosts
       (job-boards.greenhouse.io / boards.greenhouse.io) */
    const onGreenhouseBoard = /^(?:job-)?boards\.greenhouse\.io$/i.test(host(loc.href || (loc && loc.hostname) || ''));
    const resumeOpts = Object.assign({ dropzone: onGreenhouseBoard }, env.resumeOpts);

    /* 9 — ATTACH THE RÉSUMÉ FIRST. Revealing Greenhouse's lazy native file input
       (clicking "Attach") can make React RE-RENDER the whole form, which would
       wipe any text we had already filled. So we attach BEFORE typing anything —
       the re-render then has no filled fields to clear. */
    let rdiag = { resumeInputFound: false, fileAssigned: false, filenameConfirmed: false, uploadError: null, method: null, ok: false };
    if (typeof attachResume === 'function') {
      try { rdiag = await attachResume(haveResume ? resume : null, resumeOpts); } catch (e) { /* best-effort */ }
    }

    /* 10 — wait for the form to STABILIZE after the attach-triggered re-render,
       so the fields we fill next are the ones that survive */
    const stable = env.waitStable || waitStable;
    await stable(doc, env.stableOpts);

    /* 11 — run Autofill v2 for the text fields. It only fills EMPTY fields and
       never overwrites, so it re-populates whatever the re-render cleared without
       touching anything the user (or a prior pass) already set. Its résumé step
       also re-checks the now-present input and re-attaches only if a re-render
       cleared the file — so text and résumé end up filled together. */
    let result;
    try { result = autofill(profile, haveResume ? resume : null); }
    catch (e) { return attention(ctx, 'autofill-error', detection); }

    /* 12 — final résumé state: re-attach once if filling text triggered a late
       re-render that cleared the file (never re-clicks "Attach" — the input now
       exists) and take the authoritative diagnostics from here */
    /* the method that ACTUALLY uploaded on the first pass (input vs dropzone) —
       the re-verify below finds the file already present and would mislabel it */
    const firstMethod = (rdiag.ok && rdiag.method) ? rdiag.method : null;
    if (typeof attachResume === 'function') {
      try {
        const again = await attachResume(haveResume ? resume : null, resumeOpts);
        if (again.ok && again.already && firstMethod) again.method = firstMethod;   // keep the real method
        rdiag = again;
      } catch (e) { /* keep prior rdiag */ }
    } else if ((result.filled || []).indexOf('Resume') !== -1) {
      rdiag = { resumeInputFound: true, fileAssigned: true, filenameConfirmed: true, uploadError: null, method: 'input', ok: true };
    }
    /* only report the résumé as filled when the upload TRULY succeeded */
    const uploadOk = !!rdiag.ok;
    if (uploadOk && (result.filled || []).indexOf('Resume') === -1) result.filled.push('Resume');

    /* popup diagnostics — the honest state of every step (no false green) */
    await storage.set(RESUME_DIAG_KEY, {
      resumeFound: haveResume,
      resumeInputFound: rdiag.resumeInputFound,
      fileAssigned: rdiag.fileAssigned,
      filenameConfirmed: rdiag.filenameConfirmed,
      uploadError: rdiag.uploadError || null,
      method: rdiag.method || null,
      ok: uploadOk,
      name: (resume && resume.name) || null,
      url: (loc && loc.href) || '', ts: now,
    });

    /* the page asks for a résumé but no default résumé exists → the user must
       attach one (text fields are already filled to save them the typing) */
    if (!haveResume && rdiag.resumeInputFound) return attention(ctx, 'no-resume', detection);

    /* a résumé exists and there is a résumé field, but Greenhouse rejected the
       programmatic upload (no matching file / no filename / widget error) → flag
       Needs Attention, keep the text filled, and never show a false green. */
    if (haveResume && rdiag.resumeInputFound && !uploadOk) return attention(ctx, 'resume-upload-failed', detection);

    await storage.set(RESULT_KEY, {
      token: pending.token, jobId: pending.jobId, url: loc.href,
      ats: detection.ats, filled: result.filled || [], unknown: result.unknown || [], ts: now,
    });
    await report(STAGE.COMPLETED, {
      token: pending.token, jobId: pending.jobId, ats: detection.ats,
      filled: (result.filled || []).length, unknown: (result.unknown || []).length,
    });
    return { ran: true, ats: detection.ats, supported: detection.supported, result };
  }

  /* do nothing on the page; hand a "needs attention" back to the Queue AND
     surface it as the popup's diagnostic status */
  async function attention(ctx, reason, detection) {
    const ats = (detection && detection.ats) || null;
    await ctx.storage.set(ATTN_KEY, {
      token: ctx.pending.token, jobId: ctx.pending.jobId, url: ctx.pending.url,
      reason, ats, ts: ctx.now,
    });
    await ctx.storage.set(STATUS_KEY, {
      stage: STAGE.ATTENTION, reason, ats,
      token: ctx.pending.token, jobId: ctx.pending.jobId,
      url: (ctx.loc && ctx.loc.href) || ctx.pending.url, ts: ctx.now,
    });
    return { ran: false, reason, attention: true };
  }

  return {
    run, matchIntent, normHost, hasApplicationForm, detectBlocker, waitForForm, waitStable,
    PENDING_KEY, DATA_KEY, DONE_KEY, ATTN_KEY, RESULT_KEY, STATUS_KEY, RESUME_KEY, RESUME_DIAG_KEY, STAGE,
  };
})();

/* auto-run only inside a REAL extension content-script context (a stubbed
   chrome in a test harness has no runtime.id, so this never fires there) */
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && typeof document !== 'undefined') {
  AutoApply.run().catch(() => { /* best-effort; never throws into the page */ });
}

if (typeof module !== 'undefined' && module.exports) module.exports = AutoApply;
