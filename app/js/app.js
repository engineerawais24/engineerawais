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
  profile:   { label: 'Profile',         title: 'Career Profile',       render: () => Profile.render(), badge: () => Profile.isDirty() ? '•' : 0 },
  jobs:      { label: "Today's Jobs",    title: "Today's Jobs",         render: () => Jobs.render(), badge: () => Jobs.pendingCount() },
  approvals: { label: 'Approvals',       title: 'Approvals',            render: renderApprovals, badge: () => DB.approvals.filter(a => a.status === 'awaiting').length },
  review:    { label: 'Application Review', title: 'Application Review', render: () => Prep.renderReview(), hidden: true },
  applications: { label: 'Applications', title: 'Applications Board',   render: () => Applications.render() },
  resumes:   { label: 'Resume Library',  title: 'Resume Library',       render: () => Resumes.render() },
  tracker:   { label: 'Tracker',         title: 'Applications Tracker', render: renderTracker },
  interview: { label: 'Interview Prep',  title: 'Interview Prep',       render: () => Interview.render() },
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
  const nav = Object.entries(SCREENS).filter(([, s]) => !s.hidden).map(([key, s]) => {
    const badge = s.badge ? s.badge() : 0;
    const badgeCls = badge === '•' ? 'badge amber' : 'badge';
    return `
      <button class="nav-item ${key === route ? 'active' : ''}" onclick="location.hash='#/${key}'">
        <span class="dot"></span>
        <span>${s.label}</span>
        ${badge ? `<span class="${badgeCls}">${badge}</span>` : ''}
      </button>`;
  }).join('');
  document.getElementById('nav').innerHTML = nav;
}

/* toast() now lives in lib/notify.js (stacked, typed, feeds Activity) */

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  /* live analytics computed from the Applications board */
  const cc = Applications.counts();
  const conv = cc.total ? Math.round(((cc.interview + cc.offer) / cc.total) * 100) : 0;
  const succ = cc.total ? Math.round((cc.offer / cc.total) * 100) : 0;
  const statData = [
    { k: 'Applications',         v: '128',       d: `${cc.total} on the board now`, up: false },
    { k: 'Interview conversion', v: conv + '%',  d: `${cc.interview + cc.offer} of ${cc.total} progressed`, up: conv >= 25 },
    { k: 'Success rate',         v: succ + '%',  d: `${cc.offer} offer${cc.offer === 1 ? '' : 's'} on the board`, up: succ > 0 },
    { k: 'Avg salary',           v: '$148k',     d: 'target band', up: false },
  ];
  const stats = statData.map(s => `
    <div class="card stat">
      <div class="k">${s.k}</div>
      <div class="v">${s.v}</div>
      <div class="d ${s.up ? 'up' : ''}">${s.d}</div>
    </div>`).join('');

  /* monthly activity: seeded history + live Jun/Jul from the board */
  const liveMonths = { '2026-06': { m: 'Jun', n: 0 }, '2026-07': { m: 'Jul', n: 0 } };
  Applications.getItems().forEach(a => {
    const k = (a.applied || '').slice(0, 7);
    if (liveMonths[k]) liveMonths[k].n++;
  });
  const months = [...DB.monthly, ...Object.values(liveMonths).map(x => ({ ...x, live: true }))];
  const maxM = Math.max(...months.map(x => x.n), 1);
  const bars = months.map(x => `
    <div class="col">
      <div class="bar" title="${x.n} application${x.n === 1 ? '' : 's'}"
           style="height:${Math.max(4, Math.round(x.n / maxM * 100))}%; background:${x.live ? 'var(--accent)' : 'var(--accent-soft)'}"></div>
      <span class="lbl">${x.m}</span>
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

  /* recent activity timeline — fed by Activity (every toast logs) */
  const timeline = Activity.recent(7).map(e => `
    <div class="tl-row">
      <span class="tl-dot ${e.type}"></span>
      <div class="tl-body"><p>${e.msg}</p><span class="tl-time">${Activity.rel(e.t)}</span></div>
    </div>`).join('') ||
    '<div class="empty" style="border:none"><b>No activity yet</b>Actions you take will show up here.</div>';

  /* live counts from the Applications board — always current
     because the dashboard re-renders on every visit */
  const pc = cc;
  const pipeline = `
    <div class="card card-pad pipe-card">
      <div class="pipe-head">
        <p class="card-title" style="margin:0">Application pipeline</p>
        <span class="eyebrow" style="font-size:9px">LIVE · SYNCED WITH BOARD</span>
        <a class="open" href="#/applications">Open board →</a>
      </div>
      <div class="pipe-row">
        ${ApplicationsView.COLS.map(c => `
          <a class="pipe-item" href="#/applications">
            <div class="n" style="color:${c.color}">${pc[c.id]}</div>
            <div class="l">${c.label}</div>
          </a>`).join('')}
      </div>
    </div>`;

  return `
    <div class="grid grid-4">${stats}</div>
    ${pipeline}
    <div class="dash-mid">
      <div class="card card-pad">
        <p class="card-title">Monthly activity · applications sent</p>
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
      <div class="card card-pad">
        <p class="card-title">Recent activity</p>
        <div class="tline">${timeline}</div>
      </div>
    </div>`;
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
          <div class="dv"><b>${p.resume}</b> — generated copy, master untouched.</div>
          ${p.resumeVersion ? `<div class="dv" style="margin-top:5px; font-size:10px; color:var(--faint); font-family:var(--mono)">Version recorded: ${p.resumeVersion.label} · from ${p.resumeVersion.from}</div>` : ''}
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
    ${typeof PrepView !== 'undefined' ? PrepView.approvalsCard(Prep.packages()) : ''}
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
   INTERVIEW PREP — Sprint 13 Interview Copilot.
   The page now renders from the Interview controller (interview/*),
   driven by real submitted-application memory. The old sample-data
   renderer (DB.interviews) has been retired.
   ============================================================ */

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

  /* live pieces: theme state, profile summary, storage sizes */
  const escS = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const th = Theme.get();
  const pcm = Profile.completeness();
  const pp = Profile.getState().preferences;

  const appearance = `
    <div class="card card-pad">
      <p class="card-title">Appearance</p>
      <div class="theme-tiles">
        <button class="theme-tile ${th.theme !== 'dark' ? 'active' : ''}" onclick="Theme.set('light')">${Icons.get('sun', 15)} Light</button>
        <button class="theme-tile ${th.theme === 'dark' ? 'active' : ''}" onclick="Theme.set('dark')">${Icons.get('moon', 15)} Dark</button>
      </div>
      <div class="field" style="margin-top:14px; margin-bottom:0"><label>Accent color</label>
        <div class="swatches">
          ${[['indigo', '#3538CD'], ['forest', '#1E7A4D'], ['rust', '#B7791F']].map(([a, c]) => `
            <button class="swatch ${(th.accent || 'indigo') === a ? 'active' : ''}" style="background:${c}" title="${a}" onclick="Theme.setAccent('${a}')"></button>`).join('')}
        </div>
      </div>
      <div class="hint" style="margin-top:9px">Applies instantly and is remembered in this browser.</div>
    </div>`;

  const profilePrefs = `
    <div class="card card-pad">
      <p class="card-title">Profile preferences</p>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px">
        <div class="meter-track" style="flex:1"><div class="meter-fill" style="width:${pcm.pct}%"></div></div>
        <span class="mono" style="font-size:10.5px; color:var(--muted)">${pcm.pct}% complete</span>
      </div>
      <div class="pref-row"><span>Target roles</span><b>${escS(pp.targetRoles) || '—'}</b></div>
      <div class="pref-row"><span>Locations</span><b>${escS(pp.locations) || '—'}</b></div>
      <div class="pref-row"><span>Minimum salary</span><b>$${escS(pp.minSalary)}k</b></div>
      <div class="pref-row"><span>Work mode</span><b>${escS(pp.workMode)} · ${escS(pp.jobType)}</b></div>
      <div class="pref-row"><span>Outside GCC</span><b>${escS(pp.outsideGccMode)}</b></div>
      <a class="btn btn-ghost" href="#/profile" style="margin-top:12px; display:inline-block">Edit on Profile page →</a>
    </div>`;

  const localData = `
    <div class="card card-pad">
      <p class="card-title">Local data</p>
      <div class="hint" style="margin-bottom:6px">Everything CareerPilot stores lives in this browser's localStorage — nothing leaves your machine.</div>
      ${storageRows()}
      <div class="ld-actions">
        <button class="btn btn-primary" onclick="exportAllData()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('download', 13)} Export all data</button>
        <button class="btn btn-ghost btn-danger" onclick="clearAllData()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('trash', 13)} Clear all</button>
      </div>
    </div>`;

  return `
    <p class="screen-intro">Appearance and local data controls are live. Account and search preferences below are UI-only until the backend arrives.</p>
    <div class="set-grid">
      <div style="display:flex; flex-direction:column; gap:12px">
        ${appearance}
        <div class="card card-pad">
          <p class="card-title">Account</p>
          <div class="field"><label>Full name</label><input type="text" id="set-name" value="${s.name}"></div>
          <div class="field"><label>Email</label><input type="text" id="set-email" value="${s.email}"></div>
          <div class="field"><label>Target roles</label><input type="text" id="set-roles" value="${escS(pp.targetRoles)}">
            <div class="hint">Comma-separated. Shared with your Profile — the matcher scores against these.</div></div>
        </div>
        <div class="card card-pad">
          <p class="card-title">Job preferences</p>
          <div class="hint" style="margin-bottom:10px">Reads and writes the same persisted preferences as your Profile.</div>
          <div class="field"><label>Locations</label><input type="text" id="set-locations" value="${escS(pp.locations)}"></div>
          <div class="field"><label>Minimum base salary ($k)</label><input type="number" id="set-salary" value="${escS(pp.minSalary)}"></div>
          <div class="field"><label>Outside GCC work mode</label>
            <select id="set-gccmode">
              ${['Remote only', 'Remote + relocation-sponsored', 'All work modes'].map(o => `<option ${o === pp.outsideGccMode ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
            <div class="hint">GCC roles always allow every work mode; this governs the rest of the world.</div></div>
          <div class="field"><label>Daily search runs at</label>
            <select id="set-time">
              ${['05:00', '06:00', '07:00', '08:00'].map(t => `<option ${t === s.searchTime ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
        </div>
        ${localData}
      </div>
      <div style="display:flex; flex-direction:column; gap:12px">
        ${profilePrefs}
        ${SourcesView.settingsCards()}
        ${CompaniesView.settingsCard()}
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
  s.searchTime = document.getElementById('set-time').value;
  s.llm = document.getElementById('set-llm').value;
  /* shared preferences persist through the SAME source the Profile
     uses (ProfileStore) — never through the seeded DB.settings */
  Profile.updatePreferences({
    targetRoles: document.getElementById('set-roles').value,
    locations: document.getElementById('set-locations').value,
    minSalary: Number(document.getElementById('set-salary').value) || 0,
    outsideGccMode: document.getElementById('set-gccmode').value,
  });
  document.querySelectorAll('input[type=checkbox][data-group]').forEach(cb => {
    if (cb.disabled) return;
    if (cb.dataset.group === 'notif')   s.notif[cb.dataset.key] = cb.checked;
    if (cb.dataset.group === 'ai' && cb.dataset.key === 'autoTailor') s.autoTailor = cb.checked;
  });
  toast('Settings saved — preferences synced with your Profile');
}

/* ============================================================
   local data management (Settings)
   ============================================================ */
const LOCAL_STORES = () => [
  { key: ProfileStore.KEY,      label: 'Career profile' },
  { key: ApplicationsStore.KEY, label: 'Applications board' },
  { key: ResumesStore.KEY,      label: 'Generated documents' },
  { key: MasterResume.KEY,      label: 'Master resume file' },
  { key: SourcesStore.KEY,      label: 'Job sources & search config' },
  { key: ConnectorConfig.KEY,   label: 'Connector configuration (references only)' },
  { key: SyncLog.KEY,           label: 'Connector sync log' },
  { key: CompaniesStore.KEY,    label: 'Company priority tiers' },
  { key: PrepStore.KEY,         label: 'Application packages' },
  { key: SubmissionStore.KEY,   label: 'Submitted applications' },
  { key: ApplicationMemory.KEY, label: 'Application memory & interview prep' },
  { key: Activity.KEY,          label: 'Activity log' },
  { key: Theme.KEY,             label: 'Theme & UI preferences' },
];

function storageRows() {
  return LOCAL_STORES().map(({ key, label }) => {
    let size = 'empty';
    try {
      const raw = localStorage.getItem(key);
      if (raw) size = (raw.length / 1024).toFixed(1) + ' KB';
    } catch (e) { size = 'unavailable'; }
    return `
      <div class="ldrow">
        <div><b>${label}</b><span>${key} · ${size}</span></div>
        <button class="ld-clear" onclick="clearStore('${key}', '${label}')">Clear</button>
      </div>`;
  }).join('');
}

function buildExport() {
  const data = { exportedAt: new Date().toISOString(), app: 'CareerPilot AI (UI MVP)' };
  LOCAL_STORES().forEach(({ key }) => {
    try { data[key] = JSON.parse(localStorage.getItem(key)); } catch (e) { data[key] = null; }
  });
  return JSON.stringify(data, null, 2);
}

function exportAllData() {
  const blob = new Blob([buildExport()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'careerpilot-data.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Data exported as careerpilot-data.json');
}

function clearStore(key, label) {
  if (!confirm(`Clear "${label}" from this browser? The page will reload with defaults.`)) return;
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  location.reload();
}

function clearAllData() {
  if (!confirm('Clear ALL CareerPilot data from this browser? The page will reload with defaults.')) return;
  LOCAL_STORES().forEach(({ key }) => {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  });
  location.reload();
}

/* ============================================================
   top bar action + boot
   ============================================================ */
function skeletonHtml() {
  return `
    <div class="skel" style="width:220px; height:20px; margin-bottom:18px"></div>
    <div class="grid grid-4">
      <div class="skel" style="height:88px"></div><div class="skel" style="height:88px"></div>
      <div class="skel" style="height:88px"></div><div class="skel" style="height:88px"></div>
    </div>
    <div class="skel" style="height:120px; margin-top:12px"></div>
    <div class="skel" style="height:260px; margin-top:12px"></div>`;
}

function runDailySearch() {
  /* Sprint 8B: the real pipeline — sources → normalize → dedupe →
     match → salary rules → Today's Jobs (Approvals only on action) */
  DailySearch.runWithUI();
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', () => {
  if (typeof Theme !== 'undefined') Theme.init();
  if (typeof Activity !== 'undefined') Activity.init();
  if (typeof Search !== 'undefined') Search.init();
  if (!location.hash) location.hash = '#/dashboard';
  navigate();
});
