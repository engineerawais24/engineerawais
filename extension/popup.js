/* ============================================================
   CareerPilot Helper — popup controller.

   All backend calls happen HERE (extension pages are exempt from
   CORS for hosts listed in host_permissions). The content script
   only touches the page's DOM; it never talks to the network.
   ============================================================ */

const API = 'http://127.0.0.1:8000';

/* The app itself is a local file. chrome.tabs.create can open file://
   only when "Allow access to file URLs" is enabled for this extension
   (see README). */
const APP_URL = 'file:///C:/Users/m.awais/Desktop/Job%20Prject/app/index.html';

const $ = id => document.getElementById(id);

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
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
    yearsExperience: years != null ? String(years) : '',
    /* not stored in the backend — left blank on purpose, never guessed */
    noticePeriod: '',
    currentSalary: '',
    expectedSalary: (preferences.min_salary && preferences.min_salary > 0)
      ? String(preferences.min_salary * 1000) : '',
    /* nationality is only derivable when the user IS a citizen of the
       country they're authorized in — anything else would be a guess */
    nationality: (String(auth.status || '').toLowerCase() === 'citizen' && auth.authorizedIn)
      ? String(auth.authorizedIn).split(',')[0].trim() : '',
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
    setStatus('Filling empty fields…');
    const tab = await activeTab();
    const res = await askPage(tab, { type: 'autofill', profile });
    if (!res) { setStatus('No form found on this page.', 'err'); return; }

    const bits = [`Filled ${res.filled.length} field${res.filled.length === 1 ? '' : 's'}`];
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
