/* ============================================================
   CareerPilot AI — Sprint 1 frontend MVP
   Hash router + per-screen renderers. UI only: every action
   mutates in-memory DB (data.js) and re-renders. No backend.
   ============================================================ */

/* ---------- ui state (not persisted) ---------- */
const UI = {
  trackerFilter: 'All',
  interviewId: 'iv1',
  prepTab: {},          // interviewId -> active tab name
};

/* ---------- screens registry ---------- */
const SCREENS = {
  dashboard: { label: 'Dashboard',       title: 'Dashboard',            render: renderDashboard },
  jobs:      { label: "Today's Jobs",    title: "Today's Jobs",         render: renderJobs,      badge: () => DB.jobs.filter(j => j.status === 'pending').length },
  approvals: { label: 'Approvals',       title: 'Approvals',            render: renderApprovals, badge: () => DB.approvals.filter(a => a.status === 'awaiting').length },
  resumes:   { label: 'Resume Library',  title: 'Resume Library',       render: renderResumes },
  tracker:   { label: 'Tracker',         title: 'Applications Tracker', render: renderTracker },
  interview: { label: 'Interview Prep',  title: 'Interview Prep',       render: renderInterview },
  settings:  { label: 'Settings',        title: 'Settings',             render: renderSettings },
};

/* ---------- router ---------- */
function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return SCREENS[hash] ? hash : 'dashboard';
}

function navigate() {
  const route = currentRoute();
  document.getElementById('screen-title').textContent = SCREENS[route].title;
  document.getElementById('screen').innerHTML = SCREENS[route].render();
  renderNav();
  window.scrollTo(0, 0);
}

function renderNav() {
  const route = currentRoute();
  const nav = Object.entries(SCREENS).map(([key, s]) => {
    const badge = s.badge ? s.badge() : 0;
    return `
      <button class="nav-item ${key === route ? 'active' : ''}" onclick="location.hash='#/${key}'">
        <span class="dot"></span>
        <span>${s.label}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ''}
      </button>`;
  }).join('');
  document.getElementById('nav').innerHTML = nav;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const stats = DB.stats.map(s => `
    <div class="card stat">
      <div class="k">${s.k}</div>
      <div class="v">${s.v}</div>
      <div class="d ${s.up ? 'up' : ''}">${s.d}</div>
    </div>`).join('');

  const bars = DB.weekly.map(w => `
    <div class="col">
      <div class="bar" style="height:${w.pct}%"></div>
      <span class="lbl">${w.label}</span>
    </div>`).join('');

  const actions = DB.pendingActions.map(a => `
    <a class="action-row" href="#/${a.route}">
      <span class="adot" style="background:${a.color}"></span>
      <p>${a.html}</p>
    </a>`).join('');

  const funnel = DB.funnel.map(f => `
    <div class="funnel-row">
      <span class="fl">${f.label}</span>
      <div style="flex:1"><div class="fb" style="width:${f.pct}%; background:${f.color}"></div></div>
      <span class="fn">${f.n}</span>
    </div>`).join('');

  const best = DB.bestPerformers.map(b => `
    <div class="card card-pad">
      <div class="k" style="font-size:11px; color:var(--muted)">${b.k}</div>
      <div style="font-family:var(--disp); font-weight:600; font-size:16px; margin-top:5px">${b.v}</div>
      <div style="font-size:11.5px; color:var(--green); margin-top:3px">${b.d}</div>
    </div>`).join('');

  return `
    <div class="grid grid-4">${stats}</div>
    <div class="dash-mid">
      <div class="card card-pad">
        <p class="card-title">Applications · last 8 weeks</p>
        <div class="bars">${bars}</div>
      </div>
      <div class="card card-pad">
        <p class="card-title">Pending actions</p>
        <div style="display:flex; flex-direction:column; gap:4px">${actions}</div>
      </div>
    </div>
    <div class="dash-mid" style="grid-template-columns:1.4fr 1fr">
      <div class="card card-pad">
        <p class="card-title">Interview conversion funnel</p>
        <div style="display:flex; flex-direction:column; gap:9px">${funnel}</div>
      </div>
      <div class="grid" style="align-content:start">${best}</div>
    </div>`;
}

/* ============================================================
   TODAY'S JOBS
   ============================================================ */
function scoreClass(score) {
  return score >= 85 ? 'hi' : score >= 72 ? 'mid' : 'low';
}

function renderJobs() {
  const approved = DB.jobs.filter(j => j.status === 'approved').length;
  const rejected = DB.jobs.filter(j => j.status === 'rejected').length;
  const later    = DB.jobs.filter(j => j.status === 'later').length;
  const pending  = DB.jobs.filter(j => j.status === 'pending').length;

  const cards = DB.jobs.map(job => {
    const decided = job.status !== 'pending';
    const statusPill = {
      approved: '<span class="pill pill-green">Approved → tailoring queued</span>',
      rejected: '<span class="pill pill-red">Rejected</span>',
      later:    '<span class="pill pill-amber">Saved for later</span>',
    }[job.status] || '';

    const chips =
      job.reasons.map(r => `<span class="chip chip-yes">✓ ${r}</span>`).join('') +
      job.missing.map(m => `<span class="chip chip-no">△ ${m}</span>`).join('');

    const actionBtns = decided
      ? `<button class="btn btn-ghost" onclick="undoJob('${job.id}')">Undo</button>`
      : `<button class="btn btn-green" onclick="approveJob('${job.id}')">Approve</button>
         <button class="btn btn-amber" onclick="laterJob('${job.id}')">Later</button>
         <button class="btn btn-red" onclick="rejectJob('${job.id}')">Reject</button>`;

    return `
      <div class="card job-card ${decided ? 'decided' : ''}">
        <div class="row">
          <div class="job-score ${scoreClass(job.score)}">
            <span class="n">${job.score}</span><span class="m">MATCH</span>
          </div>
          <div style="flex:1; min-width:180px">
            <div class="job-head">
              <span class="jt">${job.title}</span>
              <span class="jc">· ${job.company}</span>
              ${statusPill}
            </div>
            <div class="job-meta">${job.salary} · ${job.loc} · ${job.mode}</div>
            <div class="job-chips">${chips}</div>
            <div class="job-prob">Est. interview probability ${job.prob}</div>
          </div>
          <div class="job-actions">${actionBtns}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <p class="screen-intro">Sourced overnight and scored against your master profile. Approving a job queues resume tailoring — the finished package lands in <a href="#/approvals" style="color:var(--accent); font-weight:600">Approvals</a> for final sign-off.</p>
    <div class="jobs-summary">
      <span class="t">Today's jobs · ${DB.jobs.length} sourced</span>
      <div class="counts">
        <span style="color:var(--green)">✓ ${approved} approved</span>
        <span style="color:var(--red)">✕ ${rejected} rejected</span>
        <span style="color:var(--amber)">◷ ${later + pending} pending</span>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:11px">${cards}</div>`;
}

function approveJob(id) {
  const job = DB.jobs.find(j => j.id === id);
  job.status = 'approved';
  DB.approvals.push({
    id: 'a-' + id,
    fromJob: id,
    company: job.company,
    title: job.title,
    resume: job.company + ' v1',
    ats: 82 + (job.score % 12),
    cover: `Draft generated from your master resume, tuned to the ${job.title} posting at ${job.company}. Review wording before it goes out…`,
    changes: [`+${8 + (job.score % 9)} keywords matched`, 'Impact bullets reordered'],
    when: 'Tailored just now',
    status: 'awaiting',
  });
  toast(`Approved — ${job.company} package added to Approvals`);
  navigate();
}

function rejectJob(id) {
  DB.jobs.find(j => j.id === id).status = 'rejected';
  toast('Rejected — the matcher learns from this (Sprint 3)');
  navigate();
}

function laterJob(id) {
  DB.jobs.find(j => j.id === id).status = 'later';
  toast('Saved for later');
  navigate();
}

function undoJob(id) {
  const job = DB.jobs.find(j => j.id === id);
  if (job.status === 'approved') {
    DB.approvals = DB.approvals.filter(a => a.fromJob !== id);
  }
  job.status = 'pending';
  toast('Decision undone');
  navigate();
}

/* ============================================================
   APPROVALS
   ============================================================ */
function renderApprovals() {
  const awaiting = DB.approvals.filter(a => a.status === 'awaiting');
  const queued   = DB.approvals.filter(a => a.status === 'queued');

  const pkgCard = (p, isQueued) => `
    <div class="card pkg" ${isQueued ? 'style="opacity:.62"' : ''}>
      <div class="pkg-head">
        <span class="pt">${p.title}</span>
        <span class="pc">· ${p.company}</span>
        ${isQueued ? '<span class="pill pill-green">Queued for submission</span>' : ''}
        <span class="pkg-ats" style="background:${p.ats >= 88 ? 'var(--green-soft)' : 'var(--amber-soft)'}; color:${p.ats >= 88 ? 'var(--green-ink)' : 'var(--amber)'}">ATS ${p.ats}</span>
      </div>
      <div class="pkg-docs">
        <div class="pkg-doc">
          <div class="dk">TAILORED RESUME</div>
          <div class="dv"><b>${p.resume}</b> — generated from master, master untouched.</div>
        </div>
        <div class="pkg-doc">
          <div class="dk">COVER LETTER · EXCERPT</div>
          <div class="dv">${p.cover}</div>
        </div>
      </div>
      <div class="pkg-changes">
        ${p.changes.map(c => `<span class="chip chip-yes">✓ ${c}</span>`).join('')}
      </div>
      <div class="pkg-foot">
        ${isQueued
          ? `<button class="btn btn-ghost" onclick="unqueuePackage('${p.id}')">Move back to review</button>`
          : `<button class="btn btn-green" onclick="approvePackage('${p.id}')">Approve &amp; queue</button>
             <button class="btn btn-ghost" onclick="editPackage()">Edit documents</button>
             <button class="btn btn-red" onclick="rejectPackage('${p.id}')">Reject</button>`}
        <span class="when">${p.when}</span>
      </div>
    </div>`;

  const awaitingHtml = awaiting.length
    ? awaiting.map(p => pkgCard(p, false)).join('')
    : `<div class="empty"><b>All clear</b>Nothing awaiting your sign-off. Approve jobs in Today's Jobs to generate new packages.</div>`;

  const queuedHtml = queued.length
    ? `<div class="group-label">QUEUED TODAY · SUBMITS ON YOUR CONFIRMATION AT 5 PM</div>
       <div style="display:flex; flex-direction:column; gap:11px">${queued.map(p => pkgCard(p, true)).join('')}</div>`
    : '';

  return `
    <p class="screen-intro">Every application package waits here for your explicit sign-off — nothing is ever sent without you. Approving moves it to today's submission queue (mock).</p>
    <div style="display:flex; flex-direction:column; gap:11px">${awaitingHtml}</div>
    ${queuedHtml}`;
}

function approvePackage(id) {
  DB.approvals.find(a => a.id === id).status = 'queued';
  toast('Approved — queued for submission (mock)');
  navigate();
}

function unqueuePackage(id) {
  DB.approvals.find(a => a.id === id).status = 'awaiting';
  toast('Moved back to review');
  navigate();
}

function rejectPackage(id) {
  const p = DB.approvals.find(a => a.id === id);
  DB.approvals = DB.approvals.filter(a => a.id !== id);
  toast(`${p.company} package rejected and discarded`);
  navigate();
}

function editPackage() {
  toast('Document editor ships in Sprint 2');
}

/* ============================================================
   RESUME LIBRARY
   ============================================================ */
function renderResumes() {
  const variants = DB.variants.map(v => `
    <div class="card variant">
      <div>
        <div class="vt">${v.company} · ${v.title}</div>
        <div class="vm">${v.meta}</div>
      </div>
      <span class="ats" style="background:${v.tone === 'green' ? 'var(--green-soft)' : 'var(--amber-soft)'}; color:${v.tone === 'green' ? 'var(--green-ink)' : 'var(--amber)'}">ATS ${v.ats}</span>
      <div class="fmt">
        <button onclick="downloadDoc('${v.company}','DOCX')">DOCX</button>
        <button onclick="downloadDoc('${v.company}','PDF')">PDF</button>
      </div>
    </div>`).join('');

  return `
    <p class="screen-intro">One master resume is the single source of truth; every tailored variant is generated from it and versioned separately.</p>
    <div class="res-grid">
      <div class="res-master">
        <div class="rk">MASTER RESUME</div>
        <div class="rt">${DB.master.title}</div>
        <div class="rd">${DB.master.blurb}</div>
        <div class="skills">${DB.master.skills.map(s => `<span>${s}</span>`).join('')}</div>
        <button class="btn" onclick="toast('Master editor ships in Sprint 2')">Edit master · ${DB.master.updated}</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:9px">
        <div style="font-size:12.5px; font-weight:600; color:var(--body)">Tailored variants</div>
        ${variants}
        <button class="gen-variant" onclick="toast('Paste-a-JD generation ships in Sprint 2 (needs AI)')">
          <span class="plus">+</span> Generate variant for a pasted job description…
        </button>
      </div>
    </div>`;
}

function downloadDoc(company, fmt) {
  toast(`${company} ${fmt} export is mocked — real files come with the backend`);
}

/* ============================================================
   APPLICATIONS TRACKER
   ============================================================ */
const TRACKER_FILTERS = ['All', 'Screening', 'Interviewing', 'Offer', 'Applied', 'Rejected'];

const STATUS_PILL = {
  Interviewing: 'pill-indigo',
  Offer: 'pill-green',
  Screening: 'pill-amber',
  Applied: 'pill-neutral',
  Rejected: 'pill-red',
};

const NEXT_COLOR = { red: 'var(--red)', amber: 'var(--amber)', body: 'var(--body)', ghost: 'var(--ghost)' };

function renderTracker() {
  const rows = DB.applications
    .filter(a => UI.trackerFilter === 'All' || a.status === UI.trackerFilter)
    .map(a => `
      <div class="trow">
        <div class="co">${a.company}</div>
        <div class="pos">${a.position}</div>
        <div><span class="pill ${STATUS_PILL[a.status]}">${a.status}</span></div>
        <div class="rv">${a.resume}</div>
        <div class="sal">${a.salary}</div>
        <div class="next" style="color:${NEXT_COLOR[a.nextTone]}">${a.next}</div>
      </div>`).join('');

  const filters = TRACKER_FILTERS.map(f => {
    const count = f === 'All' ? DB.applications.length : DB.applications.filter(a => a.status === f).length;
    return `<button class="filter-chip ${UI.trackerFilter === f ? 'active' : ''}" onclick="setTrackerFilter('${f}')">${f} · ${count}</button>`;
  }).join('');

  return `
    <p class="screen-intro">Every application in one place. Statuses update automatically once email sync lands (Sprint 3); for now this is sample data.</p>
    <div class="filters">${filters}</div>
    <div class="card table">
      <div class="trow thead">
        <div>COMPANY</div><div>POSITION</div><div>STATUS</div><div>RESUME</div><div>SALARY</div><div>NEXT</div>
      </div>
      ${rows || '<div class="empty" style="border:none">No applications match this filter.</div>'}
    </div>`;
}

function setTrackerFilter(f) {
  UI.trackerFilter = f;
  navigate();
}

/* ============================================================
   INTERVIEW PREP
   ============================================================ */
function renderInterview() {
  const iv = DB.interviews.find(i => i.id === UI.interviewId) || DB.interviews[0];
  const activeTab = UI.prepTab[iv.id] || Object.keys(iv.tabs)[0];
  const tab = iv.tabs[activeTab];

  const picker = DB.interviews.map(i => `
    <button class="iv-pick ${i.id === iv.id ? 'active' : ''}" onclick="selectInterview('${i.id}')">
      <span class="co">${i.company}</span>
      <span class="wh">${i.stage}</span>
    </button>`).join('');

  const tabs = Object.keys(iv.tabs).map(t => `
    <button class="tab ${t === activeTab ? 'active' : ''}" onclick="selectPrepTab('${iv.id}','${t}')">${t}</button>`).join('');

  return `
    <p class="screen-intro">Auto-generated prep pack for each upcoming interview: company research, likely questions per round, and negotiation guidance.</p>
    <div class="iv-picker">${picker}</div>
    <div class="iv-head">
      <span class="role">${iv.company} · ${iv.role}</span>
      <span class="pill pill-indigo">${iv.stage}</span>
    </div>
    <div class="grid grid-2">
      <div class="card card-pad">
        <p class="card-title">Company research</p>
        <ul class="iv-list">${iv.research.map(r => `<li>${r}</li>`).join('')}</ul>
        <p class="card-title" style="margin:16px 0 8px">Questions to ask them</p>
        <ul class="iv-list">${iv.ask.map(q => `<li>${q}</li>`).join('')}</ul>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px">
        <div class="card card-pad">
          <div class="tabs">${tabs}</div>
          <div class="prep-label">${tab.label}</div>
          <div class="star">${tab.html}</div>
        </div>
        <div class="advice">
          <div class="ak">SALARY ADVICE</div>
          <div class="av">${iv.advice}</div>
        </div>
      </div>
    </div>`;
}

function selectInterview(id) {
  UI.interviewId = id;
  navigate();
}

function selectPrepTab(ivId, tabName) {
  UI.prepTab[ivId] = tabName;
  navigate();
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  const s = DB.settings;

  const sw = (group, key, title, desc, checked, disabled) => `
    <div class="switch-row">
      <div class="sw-txt"><b>${title}</b><span>${desc}</span></div>
      <label class="switch">
        <input type="checkbox" data-group="${group}" data-key="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="track"></span>
      </label>
    </div>`;

  return `
    <p class="screen-intro">Sprint 1: settings are UI-only and reset on refresh. Real persistence arrives with the backend.</p>
    <div class="set-grid">
      <div style="display:flex; flex-direction:column; gap:12px">
        <div class="card card-pad">
          <p class="card-title">Profile</p>
          <div class="field"><label>Full name</label><input type="text" id="set-name" value="${s.name}"></div>
          <div class="field"><label>Email</label><input type="text" id="set-email" value="${s.email}"></div>
          <div class="field"><label>Target roles</label><input type="text" id="set-roles" value="${s.targetRoles}">
            <div class="hint">Comma-separated. The matcher scores against these.</div></div>
        </div>
        <div class="card card-pad">
          <p class="card-title">Job preferences</p>
          <div class="field"><label>Locations</label><input type="text" id="set-locations" value="${s.locations}"></div>
          <div class="field"><label>Minimum base salary ($k)</label><input type="number" id="set-salary" value="${s.minSalary}"></div>
          <div class="field"><label>Daily search runs at</label>
            <select id="set-time">
              ${['05:00', '06:00', '07:00', '08:00'].map(t => `<option ${t === s.searchTime ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px">
        <div class="card card-pad">
          <p class="card-title">Job sources</p>
          ${sw('sources', 'greenhouse', 'Greenhouse', 'Direct ATS boards', s.sources.greenhouse)}
          ${sw('sources', 'lever', 'Lever', 'Direct ATS boards', s.sources.lever)}
          ${sw('sources', 'ashby', 'Ashby', 'Direct ATS boards', s.sources.ashby)}
          ${sw('sources', 'rss', 'RSS / aggregators', 'Lower reply rate — off by default', s.sources.rss)}
        </div>
        <div class="card card-pad">
          <p class="card-title">AI &amp; autonomy</p>
          <div class="field"><label>LLM provider</label>
            <select id="set-llm">
              ${['Claude (Anthropic)', 'OpenAI', 'Auto-route by task'].map(o => `<option ${o === s.llm ? 'selected' : ''}>${o}</option>`).join('')}
            </select></div>
          ${sw('ai', 'autoTailor', 'Auto-tailor on approval', 'Generate resume + cover letter when you approve a job', s.autoTailor)}
          ${sw('ai', 'approval', 'Require approval before sending', 'Core guarantee — cannot be disabled', true, true)}
          <div class="locked-note">🔒 Human-in-the-loop is locked on. CareerPilot never submits an application without your explicit sign-off.</div>
        </div>
        <div class="card card-pad">
          <p class="card-title">Notifications</p>
          ${sw('notif', 'digest', 'Morning digest', 'Daily email with new matches', s.notif.digest)}
          ${sw('notif', 'followups', 'Follow-up reminders', 'Nudge when an application goes quiet', s.notif.followups)}
          ${sw('notif', 'interviews', 'Interview alerts', '24h and 1h before each interview', s.notif.interviews)}
        </div>
        <div>
          <button class="btn btn-primary" onclick="saveSettings()">Save settings</button>
        </div>
      </div>
    </div>`;
}

function saveSettings() {
  const s = DB.settings;
  s.name = document.getElementById('set-name').value;
  s.email = document.getElementById('set-email').value;
  s.targetRoles = document.getElementById('set-roles').value;
  s.locations = document.getElementById('set-locations').value;
  s.minSalary = Number(document.getElementById('set-salary').value);
  s.searchTime = document.getElementById('set-time').value;
  s.llm = document.getElementById('set-llm').value;
  document.querySelectorAll('input[type=checkbox][data-group]').forEach(cb => {
    if (cb.disabled) return;
    if (cb.dataset.group === 'sources') s.sources[cb.dataset.key] = cb.checked;
    if (cb.dataset.group === 'notif')   s.notif[cb.dataset.key] = cb.checked;
    if (cb.dataset.group === 'ai' && cb.dataset.key === 'autoTailor') s.autoTailor = cb.checked;
  });
  toast('Settings saved (in-memory only — resets on refresh)');
}

/* ============================================================
   top bar action + boot
   ============================================================ */
function runDailySearch() {
  toast('Daily search queued (mock) — sourcing runs nightly once the backend lands');
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', () => {
  if (!location.hash) location.hash = '#/dashboard';
  navigate();
});
