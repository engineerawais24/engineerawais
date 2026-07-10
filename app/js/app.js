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
  jobs:      { label: "Today's Jobs",    title: "Today's Jobs",         render: renderJobs,      badge: () => DB.jobs.filter(j => j.status === 'pending').length },
  approvals: { label: 'Approvals',       title: 'Approvals',            render: renderApprovals, badge: () => DB.approvals.filter(a => a.status === 'awaiting').length },
  applications: { label: 'Applications', title: 'Applications Board',   render: () => Applications.render() },
  resumes:   { label: 'Resume Library',  title: 'Resume Library',       render: () => Resumes.render() },
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

  /* live pieces: theme state, profile summary, storage sizes */
  const escS = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        ${localData}
      </div>
      <div style="display:flex; flex-direction:column; gap:12px">
        ${profilePrefs}
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
   local data management (Settings)
   ============================================================ */
const LOCAL_STORES = () => [
  { key: ProfileStore.KEY,      label: 'Career profile' },
  { key: ApplicationsStore.KEY, label: 'Applications board' },
  { key: ResumesStore.KEY,      label: 'Generated documents' },
  { key: MasterResume.KEY,      label: 'Master resume file' },
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
  const screen = document.getElementById('screen');
  if (screen) screen.innerHTML = skeletonHtml();
  setTimeout(() => {
    navigate();
    toast('Daily search complete — 6 matches waiting on Today’s Jobs (mock)', 'info');
  }, 800);
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', () => {
  if (typeof Theme !== 'undefined') Theme.init();
  if (typeof Activity !== 'undefined') Activity.init();
  if (typeof Search !== 'undefined') Search.init();
  if (!location.hash) location.hash = '#/dashboard';
  navigate();
});
