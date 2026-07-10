/* ============================================================
   ProfileView — pure rendering for the Career Profile screen.
   Takes state + errors, returns HTML strings. No state of its
   own; all events call methods on the Profile controller.
   ============================================================ */

const ProfileView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- field primitives ---------- */

  function fieldError(err) {
    return err ? `<div class="ferr">${Icons.get('alert', 12)} ${esc(err)}</div>` : '';
  }

  function textField({ path, label, value, err, req = false, half = false, ph = '', hint = '', type = 'text' }) {
    return `
      <div class="field ${half ? 'half' : ''}">
        <label>${label}${req ? ' <b class="req">*</b>' : ''}</label>
        <input type="${type}" value="${esc(value)}" placeholder="${esc(ph)}"
               class="${err ? 'err' : ''}" oninput="Profile.input(this,'${path}')">
        ${fieldError(err)}
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>`;
  }

  function textArea({ path, label, value, ph = '' }) {
    return `
      <div class="field">
        <label>${label}</label>
        <textarea rows="4" placeholder="${esc(ph)}" oninput="Profile.input(this,'${path}')">${esc(value)}</textarea>
      </div>`;
  }

  function selectField({ path, label, value, options, half = false }) {
    return `
      <div class="field ${half ? 'half' : ''}">
        <label>${label}</label>
        <select onchange="Profile.input(this,'${path}')">
          ${options.map(o => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
      </div>`;
  }

  function switchRow({ path, title, desc, checked }) {
    return `
      <div class="switch-row">
        <div class="sw-txt"><b>${title}</b><span>${desc}</span></div>
        <label class="switch">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="Profile.check(this,'${path}')">
          <span class="track"></span>
        </label>
      </div>`;
  }

  function card(id, icon, num, title, desc, body) {
    return `
      <section class="card pcard" id="card-${id}">
        <header class="phead">
          <div class="ptile">${Icons.get(icon)}</div>
          <div>
            <div class="pnum">${num}</div>
            <h3>${title}</h3>
            <p>${desc}</p>
          </div>
        </header>
        <div class="pbody">${body}</div>
      </section>`;
  }

  /* One previous-employer row inside the Employment history card.
     Mirrors the ProfileStore.history structure the AI parser fills. */
  function empRow(h, i) {
    return `
      <div class="emp-row">
        <div class="emp-head">
          <span class="pnum">EMPLOYER ${String(i + 1).padStart(2, '0')}</span>
          <span class="src-chip ${h.source === 'manual' ? '' : 'ai'}">${h.source === 'manual' ? 'MANUAL' : 'AI PARSED'}</span>
          <button class="rep-remove" title="Remove employer" onclick="Profile.removeEmployer(${i})">×</button>
        </div>
        <div class="emp-grid">
          <div class="field half"><label>Company</label>
            <input value="${esc(h.company)}" placeholder="Company name" oninput="Profile.setEmployer(this,${i},'company')"></div>
          <div class="field half"><label>Job title</label>
            <input value="${esc(h.title)}" placeholder="Role" oninput="Profile.setEmployer(this,${i},'title')"></div>
          <div class="field half"><label>Location</label>
            <input value="${esc(h.location)}" placeholder="City, Country / Remote" oninput="Profile.setEmployer(this,${i},'location')"></div>
          <div class="field half"><label>Start date</label>
            <input type="month" value="${esc(h.startDate)}" onchange="Profile.setEmployer(this,${i},'startDate')"></div>
          <div class="field half"><label>End date</label>
            <input type="month" value="${esc(h.endDate)}" ${h.current ? 'disabled' : ''} onchange="Profile.setEmployer(this,${i},'endDate')"></div>
          <div class="switch-row">
            <div class="sw-txt"><b>Current employer</b><span>Shown as “Present” on documents</span></div>
            <label class="switch">
              <input type="checkbox" ${h.current ? 'checked' : ''} onchange="Profile.setEmployerCurrent(this,${i})">
              <span class="track"></span>
            </label>
          </div>
          <div class="field"><label>Responsibilities / Achievements</label>
            <textarea rows="3" placeholder="One per line — each becomes a resume bullet" oninput="Profile.setEmployer(this,${i},'highlights')">${esc(h.highlights)}</textarea></div>
        </div>
      </div>`;
  }

  /* ---------- sections ---------- */

  const SECTIONS = {

    personal: (p, e) => card('personal', 'user', '01 / PERSONAL', 'Personal information',
      'The identity every application is built around.', `
      ${textField({ path: 'personal.firstName', label: 'First name', value: p.personal.firstName, err: e['personal.firstName'], req: true, half: true })}
      ${textField({ path: 'personal.lastName', label: 'Last name', value: p.personal.lastName, err: e['personal.lastName'], req: true, half: true })}
      ${textField({ path: 'personal.headline', label: 'Professional headline', value: p.personal.headline, err: e['personal.headline'], req: true, ph: 'e.g. Solutions Engineer' })}
      ${textArea({ path: 'personal.summary', label: 'Professional summary', value: p.personal.summary, ph: '2–4 sentences the AI uses as the top of your master resume…' })}`),

    contact: (p, e) => card('contact', 'phone', '02 / CONTACT', 'Contact information',
      'Where recruiters reach you. Email goes on every application.', `
      ${textField({ path: 'contact.email', label: 'Email', value: p.contact.email, err: e['contact.email'], req: true, half: true, type: 'text' })}
      ${textField({ path: 'contact.phone', label: 'Phone', value: p.contact.phone, half: true, ph: '+92 300 0000000' })}
      ${textField({ path: 'contact.city', label: 'City', value: p.contact.city, half: true })}
      ${textField({ path: 'contact.country', label: 'Country', value: p.contact.country, half: true })}`),

    links: (p, e) => card('links', 'link', '03 / LINKS', 'Professional links',
      'Validated before they are ever put on a document.', `
      ${textField({ path: 'links.linkedin', label: 'LinkedIn', value: p.links.linkedin, err: e['links.linkedin'], ph: 'https://linkedin.com/in/your-name' })}
      ${textField({ path: 'links.github', label: 'GitHub', value: p.links.github, err: e['links.github'], ph: 'https://github.com/username' })}
      ${textField({ path: 'links.portfolio', label: 'Portfolio / website', value: p.links.portfolio, err: e['links.portfolio'], ph: 'https://…' })}
      ${textField({ path: 'links.other', label: 'Other', value: p.links.other, err: e['links.other'], ph: 'https://…' })}`),

    employment: (p, e) => card('employment', 'briefcase', '04 / EMPLOYMENT', 'Current employment',
      'Your primary active role — previous roles live in Employment history below.', `
      ${textField({ path: 'employment.title', label: 'Job title', value: p.employment.title, half: true })}
      ${textField({ path: 'employment.company', label: 'Company', value: p.employment.company, half: true })}
      ${textField({ path: 'employment.startDate', label: 'Started', value: p.employment.startDate, half: true, type: 'month' })}
      ${selectField({ path: 'employment.type', label: 'Employment type', value: p.employment.type, options: ['Full-time', 'Contract', 'Part-time', 'Freelance'], half: true })}
      ${selectField({ path: 'employment.noticePeriod', label: 'Notice period', value: p.employment.noticePeriod, options: ['Immediate', '2 weeks', '1 month', '2 months', '3+ months'], half: true })}
      ${switchRow({ path: 'employment.current', title: 'Currently employed here', desc: 'Shown as “present” on generated resumes', checked: p.employment.current })}
      ${textArea({ path: 'employment.highlights', label: 'Responsibilities / achievements', value: p.employment.highlights, ph: 'One per line — these become your top resume bullets…' })}`),

    history: (p) => card('history', 'briefcase', '05 / HISTORY', 'Employment history',
      'Previous roles. Once AI parsing is enabled, your uploaded master resume fills this automatically — you review before it lands on documents.', `
      ${p.history.map((h, i) => empRow(h, i)).join('')
        || '<div class="hint" style="margin-bottom:11px">No previous employers yet — add your most recent first.</div>'}
      <button class="gen-variant" onclick="Profile.addEmployer()"><span class="plus">+</span> Add Previous Employer</button>`),

    resume: () => {
      const m = MasterResume.get();
      const body = m ? `
        <div class="mfile">
          <div class="mfile-ic ${m.kind}">${m.kind.toUpperCase()}</div>
          <div class="mfile-info">
            <b>${esc(m.name)}</b>
            <span>${MasterResume.fmtSize(m.size)} · Uploaded ${MasterResume.fmtDate(m.uploadedAt)}</span>
          </div>
        </div>
        <div class="mfile-actions">
          <button class="btn btn-ghost" onclick="MasterResume.download()">Download</button>
          <button class="btn btn-ghost" onclick="MasterResume.pick()">Replace Resume</button>
          <button class="btn btn-ghost btn-danger" onclick="MasterResume.remove()">Remove Resume</button>
        </div>` : `
        <div class="dropzone" onclick="MasterResume.pick()"
             ondragover="MasterResume.dragOver(event)" ondragleave="MasterResume.dragLeave(event)"
             ondrop="MasterResume.drop(event)">
          ${Icons.get('upload', 18)}
          <div><b>Upload master resume</b><span>PDF or DOCX · up to 2.5 MB · drag &amp; drop or click</span></div>
        </div>`;
      return card('resume', 'file', '09 / RESUME LIBRARY', 'Resume library',
        'Your uploaded master is the source document behind every tailored variant.', body + `
        <a class="btn btn-ghost" href="#/resumes" style="display:inline-flex; align-items:center; gap:7px; margin-top:11px">
          ${Icons.get('file', 13)} Open Resume Library
        </a>`);
    },

    skills: (p) => card('skills', 'zap', '06 / SKILLS', 'Skills',
      'Every match score starts from this list. Press Enter to add.', `
      <div class="tags">
        ${p.skills.map((s, i) => `
          <span class="tag">${esc(s)}<button title="Remove" onclick="Profile.removeSkill(${i})">×</button></span>`).join('')
        || '<span class="hint">No skills yet — add your strongest first.</span>'}
      </div>
      <div class="tag-add">
        <input id="skill-input" placeholder="Add a skill…" onkeydown="Profile.skillKey(event)">
        <button class="btn btn-ghost" onclick="Profile.addSkill()">+ Add</button>
      </div>`),

    certifications: (p) => card('certifications', 'award', '07 / CERTIFICATIONS', 'Certifications',
      'Surfaced automatically when a job description asks for them.', `
      ${p.certifications.map((c, i) => `
        <div class="rep-row rep-cert">
          <input placeholder="Certification" value="${esc(c.name)}" onchange="Profile.setCert(this,${i},'name')">
          <input placeholder="Issuer" value="${esc(c.issuer)}" onchange="Profile.setCert(this,${i},'issuer')">
          <input placeholder="Year" value="${esc(c.year)}" onchange="Profile.setCert(this,${i},'year')">
          <button class="rep-remove" title="Remove" onclick="Profile.removeCert(${i})">×</button>
        </div>`).join('')}
      <button class="gen-variant" onclick="Profile.addCert()"><span class="plus">+</span> Add certification</button>`),

    languages: (p) => card('languages', 'globe', '08 / LANGUAGES', 'Languages',
      'Used for jobs with language requirements.', `
      ${p.languages.map((l, i) => `
        <div class="rep-row rep-lang">
          <input placeholder="Language" value="${esc(l.name)}" onchange="Profile.setLang(this,${i},'name')">
          <select onchange="Profile.setLang(this,${i},'level')">
            ${['Basic', 'Conversational', 'Professional', 'Fluent', 'Native'].map(o => `<option ${o === l.level ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          <button class="rep-remove" title="Remove" onclick="Profile.removeLang(${i})">×</button>
        </div>`).join('')}
      <button class="gen-variant" onclick="Profile.addLang()"><span class="plus">+</span> Add language</button>`),

    preferences: (p) => card('preferences', 'target', '10 / PREFERENCES', 'Career preferences',
      'The daily search only sources jobs inside these bounds.', `
      ${textField({ path: 'preferences.targetRoles', label: 'Target roles', value: p.preferences.targetRoles, hint: 'Comma-separated' })}
      ${textField({ path: 'preferences.locations', label: 'Preferred locations', value: p.preferences.locations, hint: 'Comma-separated' })}
      ${textField({ path: 'preferences.minSalary', label: 'Minimum base salary ($k)', value: p.preferences.minSalary, half: true, type: 'number' })}
      ${selectField({ path: 'preferences.workMode', label: 'Work mode', value: p.preferences.workMode, options: ['Remote', 'Hybrid', 'On-site', 'Flexible'], half: true })}
      ${selectField({ path: 'preferences.jobType', label: 'Job type', value: p.preferences.jobType, options: ['Full-time', 'Contract', 'Part-time', 'Freelance'], half: true })}
      ${switchRow({ path: 'preferences.relocation', title: 'Open to relocation', desc: 'Includes on-site roles in other cities', checked: p.preferences.relocation })}`),

    authorization: (p) => card('authorization', 'shield', '11 / AUTHORIZATION', 'Work authorization',
      'Filters out jobs you legally can’t take — before you see them.', `
      ${selectField({ path: 'authorization.status', label: 'Status', value: p.authorization.status, options: ['Citizen', 'Permanent resident', 'Work visa', 'Student visa', 'No current authorization'], half: true })}
      ${textField({ path: 'authorization.authorizedIn', label: 'Authorized to work in', value: p.authorization.authorizedIn, half: true, hint: 'Comma-separated countries' })}
      ${switchRow({ path: 'authorization.sponsorship', title: 'Needs visa sponsorship abroad', desc: 'Jobs marked “no sponsorship” will be down-ranked', checked: p.authorization.sponsorship })}`),
  };

  const LEFT_COL  = ['personal', 'contact', 'links', 'employment', 'history', 'resume'];
  const RIGHT_COL = ['skills', 'certifications', 'languages', 'preferences', 'authorization'];

  function section(id, state, errors) {
    return SECTIONS[id](state, errors);
  }

  /* ---------- save bar + completeness ---------- */

  function dirtyFlag(dirty) {
    return dirty
      ? `<i class="fdot amber"></i> Unsaved changes`
      : `${Icons.get('check', 13)} All changes saved`;
  }

  function meter(pct, done, total) {
    return `
      <div class="card meter-card">
        <div>
          <div class="eyebrow">PROFILE COMPLETENESS</div>
          <div class="meter-pct">${pct}%</div>
        </div>
        <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
        <div class="meter-note">${done} of ${total} signals filled.<br>A complete profile sharpens match scores.</div>
      </div>`;
  }

  function render(state, errors, dirty, completeness) {
    return `
      <p class="screen-intro">Your master profile — the single source every match score, tailored resume and cover letter is generated from. Saved locally in this browser (no backend yet).</p>
      ${meter(completeness.pct, completeness.done, completeness.total)}
      <div class="profile-cols">
        <div class="pcol">${LEFT_COL.map(id => section(id, state, errors)).join('')}</div>
        <div class="pcol">${RIGHT_COL.map(id => section(id, state, errors)).join('')}</div>
      </div>
      <div class="save-bar">
        <span class="dirty-flag ${dirty ? 'dirty' : ''}" id="dirty-flag">${dirtyFlag(dirty)}</span>
        <div class="save-actions">
          <button class="btn btn-ghost btn-danger" onclick="Profile.reset()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('rotate', 13)} Reset</button>
          <button class="btn btn-primary" onclick="Profile.save()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('save', 13)} Save profile</button>
        </div>
      </div>`;
  }

  return { render, section, dirtyFlag };
})();
