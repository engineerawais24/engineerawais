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

  /* is this page the one the Queue opened? (exact URL, or same host after a
     locale/redirect), recent, and carrying a token */
  function matchIntent(pending, loc, now, maxAge) {
    if (!pending || !pending.url || !pending.token) return false;
    if (now - (pending.ts || 0) > (maxAge || INTENT_MAX_AGE)) return false;
    const here = (loc && loc.href) || '';
    if (canon(here) === canon(pending.url)) return true;
    return !!host(here) && host(here) === host(pending.url);
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
    const ats = env.ats || (typeof AtsEngine !== 'undefined' ? AtsEngine : null);
    const autofill = env.autofill || (typeof window !== 'undefined' && window.__cpHelper && window.__cpHelper.autofill) || null;
    const now = env.now || Date.now();
    const wait = env.waitForForm || waitForForm;

    /* 1 — only act on a matching, unconsumed, recent Queue intent */
    const pending = await storage.get(PENDING_KEY);
    if (!matchIntent(pending, loc, now, env.maxAge)) return { ran: false, reason: 'not-queue-opened' };

    /* 2 — run-once guard */
    const done = (await storage.get(DONE_KEY)) || {};
    if (done[pending.token]) return { ran: false, reason: 'already-done' };

    /* 3 — consume the intent + record the token up front, so a refresh or a
       second frame can never re-fire this same auto-apply */
    await storage.set(PENDING_KEY, null);
    done[pending.token] = now;
    await storage.set(DONE_KEY, trimDone(done));

    const ctx = { storage, pending, now };

    /* 4 — fast fail on an obvious login / CAPTCHA / blocked page */
    const early = detectBlocker(doc, loc);
    if (early) return attention(ctx, early);

    /* 5 — detect the ATS (recorded; the form is the real gate) */
    let detection = { ats: null, supported: false, confidence: 0 };
    try {
      if (ats) detection = ats.detect({ url: loc.href, html: doc && doc.documentElement ? doc.documentElement.outerHTML : '' });
    } catch (e) { /* detection is best-effort */ }

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

    /* 8 — run Universal Autofill v2 ONCE (all its safety rules apply) */
    if (typeof autofill !== 'function') return attention(ctx, 'no-engine', detection);
    let result;
    try { result = autofill(profile, data.resume || null); }
    catch (e) { return attention(ctx, 'autofill-error', detection); }

    await storage.set(RESULT_KEY, {
      token: pending.token, jobId: pending.jobId, url: loc.href,
      ats: detection.ats, filled: result.filled || [], unknown: result.unknown || [], ts: now,
    });
    return { ran: true, ats: detection.ats, supported: detection.supported, result };
  }

  /* do nothing on the page; hand a "needs attention" back to the Queue */
  async function attention(ctx, reason, detection) {
    await ctx.storage.set(ATTN_KEY, {
      token: ctx.pending.token, jobId: ctx.pending.jobId, url: ctx.pending.url,
      reason, ats: (detection && detection.ats) || null, ts: ctx.now,
    });
    return { ran: false, reason, attention: true };
  }

  return {
    run, matchIntent, hasApplicationForm, detectBlocker, waitForForm,
    PENDING_KEY, DATA_KEY, DONE_KEY, ATTN_KEY, RESULT_KEY,
  };
})();

/* auto-run only inside a REAL extension content-script context (a stubbed
   chrome in a test harness has no runtime.id, so this never fires there) */
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && typeof document !== 'undefined') {
  AutoApply.run().catch(() => { /* best-effort; never throws into the page */ });
}

if (typeof module !== 'undefined' && module.exports) module.exports = AutoApply;
