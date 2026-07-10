/* ============================================================
   ResumesView — pure rendering for the Resume Builder screen.
   Takes state, returns HTML strings. No state of its own; all
   events call methods on the Resumes controller.
   ============================================================ */

const ResumesView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- workbench (left column) ---------- */

  function appPicker(apps, appId) {
    if (!apps.length) return '<div class="hint">No applications on the board yet.</div>';
    return `
      <select class="doc-select" onchange="Resumes.selectApp(this.value)">
        ${apps.map(a => `
          <option value="${a.id}" ${a.id === appId ? 'selected' : ''}>
            ${esc(a.company)} — ${esc(a.position)}
          </option>`).join('')}
      </select>`;
  }

  function suggestions(sugg, app) {
    if (!app) return '';
    return `
      <div class="sugg">
        <div class="sugg-label">ON YOUR PROFILE</div>
        <div class="job-chips">
          ${sugg.matched.map(k => `<span class="chip chip-yes">✓ ${esc(k)}</span>`).join('')
            || '<span class="hint">No keyword overlap yet — grow your skills list on the Profile page.</span>'}
        </div>
        ${sugg.missing.length ? `
          <div class="sugg-label" style="margin-top:11px">WORTH ADDING — IF TRUE</div>
          <div class="job-chips">
            ${sugg.missing.map(k => `<span class="chip chip-no">△ ${esc(k)}</span>`).join('')}
          </div>` : ''}
        <ul class="sugg-tips">
          ${sugg.tips.map(t => `<li>${t}</li>`).join('')}
        </ul>
      </div>`;
  }

  function masterRow(m) {
    if (!m) {
      return `
        <button class="gen-variant" style="margin-bottom:9px" onclick="MasterResume.pick()">
          <span class="plus">+</span> Import master resume (PDF or DOCX)
        </button>`;
    }
    return `
      <div class="mfile mfile-compact">
        <div class="mfile-ic ${m.kind}">${m.kind.toUpperCase()}</div>
        <div class="mfile-info">
          <b>${esc(m.name)}</b>
          <span>MASTER SOURCE · ${MasterResume.fmtSize(m.size)} · ${MasterResume.fmtDate(m.uploadedAt)}</span>
        </div>
        <div class="mfile-btns">
          <button class="vload" onclick="MasterResume.pick()">Replace</button>
          <button class="vload" onclick="MasterResume.remove()">Remove</button>
        </div>
      </div>`;
  }

  function workbench(state) {
    const { apps, appId, app, sugg, docs, activeVariantId, master } = state;
    return `
      <section class="card pcard">
        <header class="phead">
          <div class="ptile">${Icons.get('target')}</div>
          <div>
            <div class="pnum">01 / TARGET</div>
            <h3>Job-specific tailoring</h3>
            <p>Pick an application — suggestions compare its keywords with your profile skills.</p>
          </div>
        </header>
        ${appPicker(apps, appId)}
        ${app ? `<div class="sugg-status">${statusPill(app.status)} <span class="mono" style="font-size:10px; color:var(--faint)">Applied ${esc(app.applied)}</span></div>` : ''}
        ${suggestions(sugg, app)}
        <div class="doc-actions">
          <button class="btn btn-primary" onclick="Resumes.generateResume()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('zap', 13)} Generate Resume</button>
          <button class="btn btn-ghost" onclick="Resumes.generateCover()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('mail', 13)} Generate Cover Letter</button>
        </div>
      </section>

      <section class="card pcard">
        <header class="phead">
          <div class="ptile">${Icons.get('file')}</div>
          <div>
            <div class="pnum">02 / LIBRARY</div>
            <h3>Master &amp; variants</h3>
            <p>The uploaded master is the source document; variants never overwrite it.</p>
          </div>
        </header>
        ${masterRow(master)}
        <div class="variant-list">
          ${docs.variants.map(v => `
            <div class="vrow ${v.id === activeVariantId ? 'active' : ''}">
              <div class="vinfo">
                <div class="vt">${esc(v.company)} · ${esc(v.title)}</div>
                <div class="vm">${esc(v.meta)}</div>
              </div>
              <span class="ats" style="background:${v.ats >= 88 ? 'var(--green-soft)' : 'var(--amber-soft)'}; color:${v.ats >= 88 ? 'var(--green-ink)' : 'var(--amber)'}">ATS ${v.ats}</span>
              <button class="vload" onclick="Resumes.loadVariant('${v.id}')">${v.id === activeVariantId ? 'Loaded' : 'Load'}</button>
            </div>`).join('')}
        </div>
      </section>`;
  }

  function statusPill(status) {
    const map = { applied: 'pill-neutral', interview: 'pill-indigo', offer: 'pill-green', rejected: 'pill-red' };
    const label = { applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' };
    return `<span class="pill ${map[status] || 'pill-neutral'}">${label[status] || status}</span>`;
  }

  /* ---------- resume paper ---------- */

  function resumePaper(profile, variant, matchedKws) {
    const p = profile;
    const name = `${p.personal.firstName} ${p.personal.lastName}`.trim() || 'Your Name';
    const contact = [p.contact.email, p.contact.phone, [p.contact.city, p.contact.country].filter(Boolean).join(', '), p.links.linkedin]
      .filter(Boolean).map(esc).join('  ·  ');
    const matched = (matchedKws || []).map(k => k.toLowerCase());
    const skills = [...p.skills].sort((a, b) =>
      (matched.includes(b.toLowerCase()) ? 1 : 0) - (matched.includes(a.toLowerCase()) ? 1 : 0));

    return `
      <div class="paper">
        <div class="rp-name">${esc(name)}</div>
        <div class="rp-headline">${esc(variant ? variant.title : p.personal.headline)}</div>
        <div class="rp-contact">${contact}</div>

        ${p.personal.summary ? `
          <div class="rp-sec">SUMMARY</div>
          <p class="rp-text">${esc(p.personal.summary)}</p>` : ''}

        <div class="rp-sec">SKILLS</div>
        <div class="rp-skills">
          ${skills.map(s => `<span class="${matched.includes(s.toLowerCase()) ? 'hl' : ''}">${esc(s)}</span>`).join('')}
        </div>

        <div class="rp-sec">EXPERIENCE</div>
        ${ResumesStore.EXPERIENCE.map(x => `
          <div class="rp-job">
            <div class="rp-job-head">
              <b>${esc(x.title)}</b> — ${esc(x.company)}
              <span class="rp-period">${esc(x.period)}</span>
            </div>
            <ul>${x.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
          </div>`).join('')}

        ${p.certifications.some(c => c.name) ? `
          <div class="rp-sec">CERTIFICATIONS</div>
          <p class="rp-text">${p.certifications.filter(c => c.name).map(c => esc(`${c.name} — ${c.issuer} (${c.year})`)).join('<br>')}</p>` : ''}

        <div class="rp-cols">
          ${p.languages.some(l => l.name) ? `
            <div><div class="rp-sec">LANGUAGES</div>
            <p class="rp-text">${p.languages.filter(l => l.name).map(l => esc(`${l.name} (${l.level})`)).join(' · ')}</p></div>` : ''}
          <div><div class="rp-sec">EDUCATION</div>
          <p class="rp-text">${ResumesStore.EDUCATION.map(e => esc(`${e.degree} — ${e.school}, ${e.year}`)).join('<br>')}</p></div>
        </div>
      </div>`;
  }

  /* ---------- cover letter paper ---------- */

  function coverPaper(letter, app) {
    if (!letter) {
      return `
        <div class="paper paper-empty">
          <div class="empty" style="border:none">
            <b>No cover letter yet</b>
            ${app ? `Generate one for ${esc(app.company)} — it uses your profile and the role's keywords.` : 'Pick an application first.'}
            <div style="margin-top:14px"><button class="btn btn-primary" onclick="Resumes.generateCover()">Generate Cover Letter</button></div>
          </div>
        </div>`;
    }
    return `
      <div class="paper rp-letter">
        ${letter.split('\n\n').map(par => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('')}
      </div>`;
  }

  /* ---------- preview panel (right column) ---------- */

  function preview(state) {
    const { tab, profile, app, variant, sugg, letter, master } = state;
    const banner = variant
      ? `<div class="doc-banner">${Icons.get('zap', 12)} Tailored for <b>&nbsp;${esc(variant.company)} · ${esc(variant.title)}</b><span class="ats" style="margin-left:auto; background:var(--green-soft); color:var(--green-ink)">ATS ${variant.ats}</span></div>`
      : master
        ? `<div class="doc-banner">${Icons.get('file', 12)} Master resume — imported from&nbsp;<b>${esc(master.name)}</b><button class="mlink" onclick="MasterResume.download()">Download original</button></div>`
        : `<div class="doc-banner neutral">${Icons.get('file', 12)} Master resume — rendered live from your <a href="#/profile" style="color:var(--accent); font-weight:600">&nbsp;Profile</a></div>`;

    /* primary source: an uploaded PDF master is shown as-is;
       DOCX can't render in-browser, so the generated paper stands
       in with a note; tailored variants always use the paper */
    let resumeBody;
    if (!variant && master && master.kind === 'pdf') {
      resumeBody = `
        <div class="pdf-frame">
          <object data="${MasterResume.blobUrl()}" type="application/pdf">
            <div class="empty" style="border:none"><b>Inline PDF preview unavailable</b>Use “Download original” above to open the file.</div>
          </object>
        </div>`;
    } else {
      const docxNote = (!variant && master && master.kind === 'docx')
        ? `<div class="doc-banner neutral" style="margin-bottom:12px">${Icons.get('alert', 12)} DOCX can't be previewed in-browser — showing the profile-generated approximation. Use “Download original” above for the exact file.</div>`
        : '';
      resumeBody = docxNote + resumePaper(profile, variant, sugg ? sugg.matched : []);
    }

    return `
      <section class="card doc-main">
        <div class="doc-toolbar">
          <div class="tabs" style="margin:0">
            <button class="tab ${tab === 'resume' ? 'active' : ''}" onclick="Resumes.setTab('resume')">Resume</button>
            <button class="tab ${tab === 'cover' ? 'active' : ''}" onclick="Resumes.setTab('cover')">Cover letter</button>
          </div>
          <div class="doc-tools">
            <button class="btn btn-ghost" onclick="Resumes.copy()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('check', 13)} Copy to Clipboard</button>
            <button class="btn btn-primary" onclick="Resumes.download()" style="display:inline-flex; align-items:center; gap:7px">${Icons.get('upload', 13)} Download PDF</button>
          </div>
        </div>
        ${tab === 'resume' ? banner : ''}
        ${tab === 'resume' ? resumeBody : coverPaper(letter, app)}
      </section>`;
  }

  function render(state) {
    return `
      <p class="screen-intro">One master resume, generated live from your profile — tailored variants and cover letters per application. Download as PDF or copy as plain text for online forms.</p>
      <div class="doc-layout">
        <div class="doc-side">${workbench(state)}</div>
        ${preview(state)}
      </div>`;
  }

  return { render, resumePaper, coverPaper };
})();
