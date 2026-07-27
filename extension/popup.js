/* ============================================================
   CareerPilot Helper — popup controller.

   All backend calls happen HERE (extension pages are exempt from
   CORS for hosts listed in host_permissions). The content script
   only touches the page's DOM; it never talks to the network.
   ============================================================ */

const API = 'http://127.0.0.1:8000';

/* The CareerPilot app is served from localhost (no file:// dependency). If you
   run it on a different port, change this. */
const APP_URL = 'http://127.0.0.1:5500/app/index.html';

const $ = id => document.getElementById(id);

/* the default résumé the autofill engine uploads. It lives in the
   extension's own storage (the backend keeps no résumé binary), set once
   from the popup and reused on every autofill. */
const RESUME_KEY = 'cp_default_resume';
const RESUME_MAX = 2.5 * 1024 * 1024;   // matches the app's MasterResume cap

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

/* ---------- default résumé (via SafeStorage) ----------
   SafeStorage wraps chrome.storage.local and never throws if it's
   unavailable (e.g. the extension was updated but not reloaded, so the
   "storage" permission isn't live yet) — it falls back to an in-memory
   session store. It never touches website localStorage. */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function getResume() { return SafeStorage.get(RESUME_KEY); }
/* completely REPLACE the stored default résumé — never a partial/merged write,
   so a previously stored DOCX can never linger when a new PDF is chosen */
function saveResume(rec) { return SafeStorage.replace(RESUME_KEY, rec); }
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read that file'));
    r.readAsDataURL(file);
  });
}
async function showResumeInfo() {
  const rec = await getResume();
  $('resumeinfo').textContent = rec
    ? `Default résumé: ${rec.name}`
    : 'Default résumé: none set';
}

function showJob(job) {
  const el = $('job');
  if (!job || !job.title) { el.style.display = 'none'; return; }
  el.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = `${job.title}${job.company ? ' — ' + job.company : ''}`;
  el.appendChild(b);
  el.appendChild(document.createTextNode(
    [job.location, job.source].filter(Boolean).join(' · ')));
  el.style.display = 'block';
}

function showQuestions(items) {
  const wrap = $('ask');
  const list = $('ask-list');
  list.innerHTML = '';
  (items || []).slice(0, 15).forEach(q => {
    const li = document.createElement('li');
    li.textContent = q;
    list.appendChild(li);
  });
  wrap.style.display = (items && items.length) ? 'block' : 'none';
}

/* ---------- talking to the page ---------- */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function askPage(tab, message) {
  /* inject on demand (activeTab) — content.js guards against double-load */
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tab.id, message);
}

/* ---------- talking to the backend ---------- */

async function api(path, options) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch (e) {
    throw new Error('CareerPilot backend is not reachable.\nStart it with:\n  cd backend\n  .venv\\Scripts\\uvicorn app.main:app --port 8000');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body.error && body.error.message) || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

/* One flat autofill profile from the three backend endpoints.
   Nothing is invented: a fact the backend doesn't hold stays undefined
   and the matching form field is reported back as "needs your answer". */
async function loadProfile() {
  const [profile, preferences, employment] = await Promise.all([
    api('/api/profile'),
    api('/api/preferences').catch(() => ({})),
    api('/api/employment').catch(() => []),
  ]);

  const current = (employment || []).find(e => e.is_current) || (employment || [])[0] || {};

  /* total years: earliest start date → now */
  let years = null;
  const starts = (employment || []).map(e => e.start_date).filter(Boolean).sort();
  if (starts.length && /^\d{4}/.test(starts[0])) {
    const first = new Date(starts[0].slice(0, 7) + '-01T00:00:00');
    if (!isNaN(first)) years = Math.max(0, Math.round((Date.now() - first) / (365.25 * 24 * 3600 * 1000)));
  }

  const auth = profile.authorization || {};
  const links = profile.links || {};

  return {
    firstName: profile.first_name || '',
    lastName: profile.last_name || '',
    fullName: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
    email: profile.email || '',
    phone: profile.phone || '',
    city: profile.city || '',
    country: profile.country || '',
    currentTitle: current.title || profile.headline || '',
    currentCompany: current.company || '',
    /* essay templates are built from these — the user's own words only */
    headline: profile.headline || '',
    summary: profile.summary || '',
    /* explicit value wins; otherwise computed from employment history */
    yearsExperience: (auth.years_experience != null && auth.years_experience !== '')
      ? String(auth.years_experience)
      : (years != null ? String(years) : ''),
    /* not stored in the backend — left blank on purpose, never guessed */
    noticePeriod: '',
    /* explicit nationality wins; the citizen derivation is the fallback */
    nationality: auth.nationality
      ? String(auth.nationality).trim()
      : ((String(auth.status || '').toLowerCase() === 'citizen' && auth.authorizedIn)
        ? String(auth.authorizedIn).split(',')[0].trim() : ''),
    gender: auth.gender ? String(auth.gender).trim() : '',
    maritalStatus: auth.marital_status ? String(auth.marital_status).trim() : '',
    workAuthorization: [auth.status, auth.authorizedIn ? `authorized in ${auth.authorizedIn}` : '']
      .filter(Boolean).join(' — '),
    needsSponsorship: typeof auth.sponsorship === 'boolean' ? auth.sponsorship : null,
    willRelocate: typeof preferences.relocation === 'boolean' ? preferences.relocation : null,
    linkedin: links.linkedin || '',
  };
}

/* ---------- Save Current Job ---------- */

/* stable id from the canonical URL, so saving twice is a clean 409 */
function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'ext-' + (h >>> 0).toString(16);
}

$('save').addEventListener('click', async () => {
  setStatus('Reading the page…');
  showQuestions([]);
  try {
    const tab = await activeTab();
    const job = await askPage(tab, { type: 'detect' });
    if (!job || !job.title) {
      setStatus('Could not find a job posting on this page.', 'err');
      return;
    }
    showJob(job);

    const canonical = (job.url || '').split(/[?#]/)[0];
    await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: job.source || 'Company Careers',
        source_job_id: hashId(canonical || tab.url),
        title: job.title,
        company: job.company || '',
        location: job.location || '',
        apply_url: job.url || tab.url,
        canonical_url: canonical,
        raw: { detectedBy: job.detectedBy || 'generic', pageTitle: tab.title || '' },
      }),
    });
    setStatus('Saved to CareerPilot ✓', 'ok');
  } catch (e) {
    if (e.status === 409) setStatus('Already saved — this job is in CareerPilot.', 'ok');
    else setStatus(e.message, 'err');
  }
});

/* ---------- Import LinkedIn Jobs ----------
   Reads the job cards already on the open LinkedIn search page and saves each
   via the SAME POST /api/jobs used by Save Current Job. Duplicates are handled
   by the backend (same canonical URL → same source_job_id → 409), so re-running
   on the same page adds nothing new. */

$('importli').addEventListener('click', async () => {
  setStatus('Reading LinkedIn job cards…');
  showQuestions([]);
  showJob(null);
  try {
    const tab = await activeTab();
    if (!/^https?:\/\/([\w-]+\.)*linkedin\.com\//.test(tab.url || '')) {
      setStatus('Open a LinkedIn Jobs search page first, then click this.', 'err');
      return;
    }
    const res = await askPage(tab, { type: 'collectLinkedIn' });
    /* temporary debug — links matched / unique ids / cards parsed */
    const dbg = res && res.debug
      ? `\n[debug] links ${res.debug.links} · ids ${res.debug.uniqueIds} · parsed ${res.debug.parsed}` : '';
    if (res && res.debug) console.log('CareerPilot LinkedIn import', res.debug, res.jobs);
    if (!res || !res.ok || !res.jobs.length) {
      setStatus('No LinkedIn job cards found on this page.\nScroll the results list so cards render, then try again.' + dbg, 'err');
      return;
    }

    let saved = 0, dup = 0, failed = 0;
    for (const job of res.jobs) {
      const canonical = (job.url || '').split(/[?#]/)[0];
      try {
        await api('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'LinkedIn',
            source_job_id: hashId(canonical),      // stable per URL → dedup by URL
            title: job.title,
            company: job.company || '',
            location: job.location || '',
            apply_url: job.url,
            canonical_url: canonical,
            posted_date: new Date().toISOString().slice(0, 10),   // date found
            raw: { detectedBy: 'LinkedIn-list' },
          }),
        });
        saved++;
      } catch (e) {
        if (e.status === 409) dup++;
        else failed++;
      }
    }

    const bits = [`Found ${res.jobs.length} · saved ${saved}`];
    if (dup) bits.push(`${dup} already in CareerPilot`);
    if (failed) bits.push(`${failed} failed`);
    setStatus(bits.join(' · ') + dbg, failed ? 'err' : 'ok');
  } catch (e) {
    setStatus(e.message, 'err');
  }
});

/* ---------- Set Default Résumé ----------
   Cached in the extension so autofill can attach it. Same PDF/DOCX + size
   rules as the app's master-résumé upload. Nothing is sent anywhere. */

$('resume').addEventListener('click', () => $('resumefile').click());

$('resumefile').addEventListener('change', async () => {
  const file = $('resumefile').files && $('resumefile').files[0];
  if (!file) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext !== 'pdf' && ext !== 'docx') {
    setStatus('Only PDF or DOCX résumés are supported.', 'err');
    return;
  }
  if (file.size > RESUME_MAX) {
    setStatus('Résumé too large — 2.5 MB max.', 'err');
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    const rec = {
      name: file.name,
      mime: file.type || (ext === 'pdf' ? 'application/pdf' : DOCX_MIME),
      size: file.size,
      dataUrl,
      savedAt: Date.now(),
    };
    /* full replacement: drops any previous résumé first, then writes the new one */
    const r = await saveResume(rec);
    /* refresh the popup immediately to the newly selected file (source of truth) */
    await showResumeInfo();

    if (r && r.persisted) {
      setStatus(`Default résumé set — ${rec.name}`, 'ok');
    } else if (r && r.verified) {
      /* stored for this session but the write didn't persist (storage full or the
         "storage" permission isn't live). The old file is gone, not stale. */
      setStatus(`Default résumé set for this session — ${rec.name}\nIt could not be saved permanently — reload the extension (chrome://extensions → Reload) and set it again.`, 'err');
    } else {
      setStatus(`Could not save ${rec.name}. Try a smaller file, or reload the extension and retry.`, 'err');
    }
  } catch (e) {
    setStatus(e.message, 'err');
  } finally {
    $('resumefile').value = '';   // allow re-picking the same file later
  }
});

/* ---------- Autofill Application ---------- */

$('fill').addEventListener('click', async () => {
  setStatus('Loading your profile…');
  showQuestions([]);
  try {
    const profile = await loadProfile();
    if (!profile.fullName && !profile.email) {
      setStatus('Your backend profile is empty. Open CareerPilot → Settings and sync, or fill the profile via the API first.', 'err');
      return;
    }
    const resume = await getResume();      // may be null — the engine copes
    setStatus('Filling empty fields…');
    const tab = await activeTab();
    const res = await askPage(tab, { type: 'autofill', profile, resume });
    if (!res) { setStatus('No form found on this page.', 'err'); return; }

    const bits = [`Filled ${res.filled.length} field${res.filled.length === 1 ? '' : 's'}`];
    if (res.filled.indexOf('Resume') !== -1) bits.push('résumé attached');
    if (res.skipped) bits.push(`left ${res.skipped} already-answered alone`);
    setStatus(bits.join(' · ') + '\nReview everything before you submit — nothing was sent.',
      res.filled.length ? 'ok' : '');
    showQuestions(res.unknown);
  } catch (e) {
    setStatus(e.message, 'err');
  }
});

/* ---------- Open CareerPilot ---------- */

$('open').addEventListener('click', () => {
  chrome.tabs.create({ url: APP_URL });
});

/* ---------- Queue → ATS auto-run diagnostic (temporary, for the smoke test) ----------
   Reads the intent + status the background worker and the ATS content script
   record in chrome.storage.local, and shows, at a glance:
     • whether the Queue signal reached the extension (intent created + stored)
     • whether the Greenhouse content script ran + detected the ATS
     • whether Autofill v2 started / completed, or the page needs attention. */

const DIAG_STATUS  = 'cp_autofill_status';    // { stage, ats, filled, reason, ts }  — ATS tab
const DIAG_PENDING = 'cp_queue_pending';      // the un-consumed one-shot intent
const DIAG_SIGNAL  = 'cp_queue_signal_log';   // background logged the intent arriving
const DIAG_BRIDGE  = 'cp_bridge_status';      // { loaded, origin, href, ts }  — bridge content script
const DIAG_EVENT   = 'cp_last_queue_event';   // { url, token, ts }  — last queue event the bridge saw
const DIAG_RESUME  = 'cp_resume_diag';        // { resumeFound, resumeInputFound, fileAssigned, filenameConfirmed, name, ts }

const STAGE_MSG = {
  'no-intent':          { text: 'opened by hand — no queue intent (use Autofill Application)', cls: 'warn' },
  'ats-detected':       { text: 'detected — waiting for the form…', cls: 'run' },
  'autofill-started':   { text: 'autofill started…', cls: 'run' },
  'autofill-completed': { text: 'autofill completed', cls: 'ok' },
  'needs-attention':    { text: 'needs attention', cls: 'err' },
};

const escHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

const shortUrl = u => String(u || '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '').slice(0, 46);

async function showDiag() {
  const el = $('diag');
  if (!el) return;
  const [status, pending, signal, bridge, event, rez] = await Promise.all([
    SafeStorage.get(DIAG_STATUS), SafeStorage.get(DIAG_PENDING), SafeStorage.get(DIAG_SIGNAL),
    SafeStorage.get(DIAG_BRIDGE), SafeStorage.get(DIAG_EVENT), SafeStorage.get(DIAG_RESUME),
  ]);
  const yn = (v, okText, noText) => v ? [okText || 'yes ✓', 'ok'] : [noText || 'no', 'warn'];

  const rows = [];

  /* 1 — did the CareerPilot bridge content script load? */
  rows.push(bridge && bridge.loaded
    ? ['Bridge', `loaded ✓ ${bridge.origin || ''} · ${ago(bridge.ts)}`, 'ok']
    : ['Bridge', 'not loaded — open CareerPilot on http://127.0.0.1 or localhost', 'err']);

  /* 2 — the last queue event the bridge saw (timestamp + target URL) */
  rows.push(event
    ? ['Last queue event', `${shortUrl(event.url)} · ${ago(event.ts)}`, 'ok']
    : ['Last queue event', 'none — click “Open Next” in the Queue', 'warn']);

  /* 3 — did the background worker receive + store the intent? */
  rows.push(signal
    ? ['Background', `received ✓ · ${ago(signal.ts)}`, 'ok']
    : ['Background', 'no', 'warn']);

  /* intent lifecycle + the ATS-tab auto-run stage */
  if (pending) rows.push(['Intent', 'stored — waiting for the ATS tab', 'run']);
  else if (signal) rows.push(['Intent', 'consumed by the ATS tab ✓', 'ok']);
  else rows.push(['Intent', 'none stored', 'muted']);

  if (status) {
    const m = STAGE_MSG[status.stage] || { text: status.stage, cls: 'muted' };
    let detail = status.ats ? `${status.ats} · ${m.text}` : m.text;
    if (status.stage === 'autofill-completed')
      detail += ` — ${status.filled || 0} filled${status.unknown ? `, ${status.unknown} to review` : ''}`;
    if (status.stage === 'needs-attention' && status.reason) detail += ` — ${status.reason}`;
    rows.push(['Last ATS run', `${detail} · ${ago(status.ts)}`, m.cls]);
  } else {
    rows.push(['Last ATS run', 'none recorded', 'muted']);
  }

  /* résumé upload diagnostics — honest per-step state. When the overall upload
     did NOT succeed (rez.ok === false) the intermediate checks are shown amber,
     never green, so a widget rejection can't read as success. */
  const resumeRows = [];
  if (rez) {
    const failed = rez.ok === false;
    const okCls = failed ? 'warn' : 'ok';                       // no green when the upload failed
    const step = (v, okText) => v ? [okText, okCls] : ['no', 'warn'];
    const r1 = rez.resumeFound ? [`yes ✓${rez.name ? ' · ' + rez.name : ''}`, okCls] : ['no default set', 'warn'];
    resumeRows.push(['Résumé found', r1[0], r1[1]]);
    resumeRows.push(['Résumé input', ...step(rez.resumeInputFound, 'found ✓')]);
    resumeRows.push(['File assigned', ...step(rez.fileAssigned, 'assigned ✓')]);
    resumeRows.push(['Filename', ...step(rez.filenameConfirmed, 'visible ✓')]);
    const via = rez.method ? ` (via ${rez.method === 'dropzone' ? 'dropzone' : 'file input'})` : '';
    resumeRows.push(['Upload', rez.ok
      ? 'ok ✓' + via
      : ('FAILED' + (rez.uploadError ? ' — ' + rez.uploadError : ' — résumé not uploaded, attach manually')),
      rez.ok ? 'ok' : 'err']);
  }

  const render = list => list.map(([k, v, cls]) =>
    `<div class="diag-row"><span class="k">${escHtml(k)}</span><span class="v ${cls}">${escHtml(v)}</span></div>`).join('');

  el.innerHTML = '<div class="diag-h">QUEUE → ATS AUTO-RUN</div>' + render(rows) +
    (resumeRows.length ? '<div class="diag-h" style="margin-top:8px">RÉSUMÉ UPLOAD</div>' + render(resumeRows) : '');
}

/* show which résumé is set + the auto-run diagnostic the moment the popup opens,
   and keep the diagnostic live while the popup stays open */
showResumeInfo();
showDiag();
setInterval(showDiag, 1500);
