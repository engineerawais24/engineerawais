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

  function suggestions(sugg, app, intel) {
    if (!app) return '';
    const missing = intel ? intel.missing : sugg.missing;
    const tips = intel ? intel.tips : sugg.tips;
    return `
      <div class="sugg">
        <div class="sugg-label">ON YOUR PROFILE</div>
        <div class="job-chips">
          ${(intel ? intel.matched : sugg.matched).map(k => `<span class="chip chip-yes">✓ ${esc(k)}</span>`).join('')
            || '<span class="hint">No keyword overlap yet — grow your skills list on the Profile page.</span>'}
        </div>
        ${missing.length ? `
          <div class="sugg-label" style="margin-top:11px">MISSING FROM YOUR MASTER</div>
          <div class="job-chips">
            ${missing.map(k => `<span class="chip chip-no">△ ${esc(k)}</span>`).join('')}
          </div>` : ''}
        <div class="sugg-label" style="margin-top:11px">IMPROVEMENT SUGGESTIONS · NEVER INVENTS EXPERIENCE</div>
        <ul class="sugg-tips">
          ${tips.map(t => `<li>${esc(t)}</li>`).join('') || '<li>Your master already leads with this job\'s keywords.</li>'}
        </ul>
        ${intel && intel.missingInfo.length ? `
          <div class="mi-block">
            <div class="sugg-label" style="color:var(--amber)">MISSING INFORMATION · NEEDS MANUAL REVIEW</div>
            ${intel.missingInfo.map(m => `<div class="mi-row">⚠ <b>${esc(m.item)}</b> — ${esc(m.note)}</div>`).join('')}
          </div>` : ''}
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
          <b>${esc(m.name)} <span class="src-chip" title="The system reads this file but never modifies it — every tailored resume is a copy">🔒 LOCKED</span></b>
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
        ${suggestions(sugg, app, state.intel)}
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
        <div class="ai-note">${Icons.get('zap', 12)} <span>Once AI parsing is enabled (backend sprint), uploaded master resumes will populate your <a href="#/profile">Employment History</a> automatically — you review everything before it lands on documents.</span></div>
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

  /* 'YYYY-MM' → 'Jan 2023' */
  function mon(ym) {
    if (!ym) return '';
    const d = new Date(ym + '-01T00:00:00');
    return isNaN(d) ? ym : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  /* Experience for the paper, built from the live profile:
     current employment first, then employment history entries.
     Falls back to the sample data when the profile has none. */
  function rolesFrom(p) {
    const roles = [];
    const e = p.employment;
    if ((e.title || '').trim() && (e.company || '').trim()) {
      roles.push({
        title: e.title, company: e.company, location: '',
        period: (mon(e.startDate) || '—') + ' — ' + (e.current ? 'Present' : '—'),
        bullets: (e.highlights || '').split('\n').map(s => s.trim()).filter(Boolean),
      });
    }
    (p.history || []).forEach(h => {
      if (!(h.company || '').trim() && !(h.title || '').trim()) return;
      roles.push({
        title: h.title || '—', company: h.company, location: h.location || '',
        period: (mon(h.startDate) || '—') + ' — ' + (h.current ? 'Present' : (mon(h.endDate) || '—')),
        bullets: (h.highlights || '').split('\n').map(s => s.trim()).filter(Boolean),
      });
    });
    return roles.length ? roles : ResumesStore.EXPERIENCE;
  }

  function resumePaper(profile, variant, matchedKws, plan) {
    const p = profile;
    const name = `${p.personal.firstName} ${p.personal.lastName}`.trim() || 'Your Name';
    const contact = [p.contact.email, p.contact.phone, [p.contact.city, p.contact.country].filter(Boolean).join(', '), p.links.linkedin]
      .filter(Boolean).map(esc).join('  ·  ');
    const matched = (plan ? plan.ops.highlights : (matchedKws || [])).map(k => k.toLowerCase());

    /* Sprint 9C: a tailoring plan only reorders / hides / selects
       existing master content — applied here at render time */
    const skills = plan ? plan.ops.skills : [...p.skills].sort((a, b) =>
      (matched.includes(b.toLowerCase()) ? 1 : 0) - (matched.includes(a.toLowerCase()) ? 1 : 0));
    const summaryText = plan ? plan.ops.summaryText : p.personal.summary;
    const baseRoles = rolesFrom(p);
    const roles = plan
      ? baseRoles.map((x, i) => Object.assign({}, x, { bullets: plan.ops.roles[i] ? plan.ops.roles[i].order : x.bullets }))
      : baseRoles;

    const summaryBlock = summaryText ? `
          <div class="rp-sec">SUMMARY</div>
          <p class="rp-text">${esc(summaryText)}</p>` : '';
    const skillsBlock = `
        <div class="rp-sec">SKILLS</div>
        <div class="rp-skills">
          ${skills.map(s => `<span class="${matched.some(m => s.toLowerCase().includes(m) || m.includes(s.toLowerCase())) ? 'hl' : ''}">${esc(s)}</span>`).join('')}
        </div>`;

    return `
      <div class="paper">
        <div class="rp-name">${esc(name)}</div>
        <div class="rp-headline">${esc(variant ? variant.title : p.personal.headline)}</div>
        <div class="rp-contact">${contact}</div>

        ${plan && plan.ops.skillsFirst ? skillsBlock + summaryBlock : summaryBlock + skillsBlock}

        <div class="rp-sec">EXPERIENCE</div>
        ${roles.map(x => `
          <div class="rp-job">
            <div class="rp-job-head">
              <b>${esc(x.title)}</b> — ${esc(x.company)}${x.location ? ' · ' + esc(x.location) : ''}
              <span class="rp-period">${esc(x.period)}</span>
            </div>
            ${x.bullets.length ? `<ul>${x.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          </div>`).join('')}

        ${(plan ? plan.ops.certs.length : p.certifications.some(c => c.name)) ? `
          <div class="rp-sec">CERTIFICATIONS</div>
          <p class="rp-text">${(plan ? plan.ops.certs : p.certifications.filter(c => c.name).map(c => `${c.name} — ${c.issuer} (${c.year})`)).map(esc).join('<br>')}</p>` : ''}

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

  /* ---------- Sprint 9C: changes panel + difference viewer ---------- */

  const CHANGE_ICON = { promoted: '↑', hidden: '−', skills: '★', certs: '☆', summary: '¶', section: '⇅' };
  const CHANGE_CATS = [
    ['promoted', 'Bullets promoted'], ['hidden', 'Bullets hidden'],
    ['skills', 'Skills surfaced'], ['certs', 'Certifications highlighted'],
    ['summary', 'Summary changes'], ['section', 'Section-order changes'],
  ];

  /* six-tile confidence summary — rendered whenever a plan is active */
  function confidenceSummary(state) {
    const { plan, variant, audit, intel } = state;
    const tile = (v, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${v}</b><span>${l}</span></div>`;
    const ivc = audit ? TailorEngine.interviewConfidence(audit) : 'High';
    return `
      <div class="ds-stats conf-summary">
        ${tile(plan.safety.score + '%', 'Resume Safety', plan.safety.score === 100 ? 'good' : 'bad')}
        ${tile(ivc, 'Interview Confidence', ivc === 'High' ? 'good' : ivc === 'Blocked' ? 'bad' : '')}
        ${tile(variant.ats, 'ATS Match', 'good')}
        ${tile('0', 'Facts Changed', 'good')}
        ${tile('0', 'Facts Invented', 'good')}
        ${tile(intel ? intel.missing.length : 0, 'Missing Keywords', intel && intel.missing.length ? 'bad' : 'good')}
      </div>`;
  }

  function changesPanel(plan) {
    const byType = t => plan.changes.filter(c => c.type === t);
    return `
      <div class="chg-panel">
        <div class="sugg-label">CHANGES MADE · REORDER, EMPHASIS AND HIDING ONLY — NO FACTS TOUCHED</div>
        ${CHANGE_CATS.map(([type, label]) => {
          const items = byType(type);
          return `
            <div class="chg-cat"><span class="chg-ic">${CHANGE_ICON[type]}</span> ✓ ${label} (${items.length})</div>
            ${items.map(c => `<div class="chg-row">${esc(c.text)}</div>`).join('')}`;
        }).join('')}
        <div class="chg-safety ${plan.safety.score === 100 ? 'ok' : 'warn'}">
          ${plan.safety.score === 100
            ? `Unsupported claims: 0 · Interview Safety Check passed — ${esc(plan.interviewCheck.note)} Generation is blocked whenever unsupported content exists.`
            : `⚠ Unsupported claims: ${plan.safety.unsupported.length} — never inserted automatically, generation blocked: ${plan.safety.unsupported.map(esc).join('; ')}`}
        </div>
      </div>`;
  }

  /* per-bullet Interview Safety audit panel */
  function auditPanel(audit) {
    const PILL = {
      safe: '<span class="pill pill-green">Safe to discuss</span>',
      prep: '<span class="pill pill-amber">Needs preparation</span>',
      blocked: '<span class="pill pill-red">Unsupported · blocked</span>',
    };
    return `
      <div class="audit-panel">
        <div class="sugg-label">INTERVIEW SAFETY CHECK · EVERY PROMOTED BULLET</div>
        ${audit.length ? audit.map(a => `
          <div class="audit-row">
            <div class="audit-top">${PILL[a.status]}<span class="audit-src">${esc(a.source)}</span></div>
            <div class="audit-text">“${esc(a.text)}”</div>
            <div class="audit-note">${esc(a.note)}</div>
          </div>`).join('')
          : '<div class="audit-row"><div class="audit-note">No bullets were promoted — the master ordering already fits this role.</div></div>'}
        <div class="chg-safety ok">Every bullet traces back to your master resume or saved profile history.</div>
      </div>`;
  }

  function diffViewer(masterC, plan, profile) {
    const hiddenAll = plan.ops.roles.flatMap(r => r.hidden);
    const promotedTexts = plan.changes.filter(c => c.type === 'promoted').map(c => c.text);
    const wasPromoted = b => promotedTexts.some(t => t.includes(b.slice(0, 40)));
    const col = (title, roles, opts) => `
      <div class="diff-col">
        <div class="diff-title">${title}</div>
        <div class="diff-skills">${(opts.skills).map(s =>
          `<span class="${opts.surfaced && plan.ops.highlights.includes(s) ? 'diff-surfaced' : ''}">${esc(s)}</span>`).join('')}</div>
        ${roles.map(r => `
          <div class="diff-role"><b>${esc(r.title)}</b> — ${esc(r.company)}
            <ul>${r.bullets.map(b => `<li class="${opts.markHidden && hiddenAll.includes(b) ? 'diff-hidden' : ''} ${opts.markPromoted && wasPromoted(b) ? 'diff-promoted' : ''}">${opts.markPromoted && wasPromoted(b) ? '↑ ' : ''}${esc(b)}</li>`).join('')}</ul>
          </div>`).join('')}
      </div>`;
    const tailoredRoles = masterC.roles.map((r, i) => Object.assign({}, r, { bullets: plan.ops.roles[i] ? plan.ops.roles[i].order : r.bullets }));
    return `
      <div class="diff-note">🔒 The Master Resume remains untouched — the tailored version only changes presentation, ordering and emphasis.
        <span class="diff-legend"><i class="lg-promoted">↑ promoted</i><i class="lg-hidden">struck = hidden</i><i class="lg-surfaced">highlight = reordered/surfaced</i></span>
      </div>
      <div class="diff-view">
        ${col('MASTER RESUME (SOURCE OF TRUTH)', masterC.roles, { skills: masterC.skills, markHidden: true })}
        ${col('TAILORED RESUME (REORDERED + EMPHASIZED)', tailoredRoles, { skills: plan.ops.skills, markPromoted: true, surfaced: true })}
      </div>`;
  }

  /* ---------- preview panel (right column) ---------- */

  function preview(state) {
    const { tab, profile, app, variant, sugg, letter, master, plan } = state;
    const banner = variant
      ? `<div class="doc-banner">${Icons.get('zap', 12)} Tailored for <b>&nbsp;${esc(variant.company)} · ${esc(variant.title)}</b>
          ${plan ? `<span class="ats" style="background:${plan.safety.score === 100 ? 'var(--green-soft)' : 'var(--amber-soft)'}; color:${plan.safety.score === 100 ? 'var(--green-ink)' : 'var(--amber)'}" title="Resume Safety Score — % of content verified against your master">Safety ${plan.safety.score}%</span>` : ''}
          <span class="ats" style="margin-left:auto; background:var(--green-soft); color:var(--green-ink)">ATS ${variant.ats}</span></div>`
        + (plan ? `
          ${confidenceSummary(state)}
          <div class="tailor-actions">
            <button class="btn btn-ghost ${state.showChanges ? 'active-tool' : ''}" onclick="Resumes.toggleChanges()">Changes made ${plan.changes.length ? '· ' + plan.changes.length : ''}</button>
            <button class="btn btn-ghost ${state.showDiff ? 'active-tool' : ''}" onclick="Resumes.toggleDiff()">View differences</button>
            <button class="btn btn-ghost ${state.showAudit ? 'active-tool' : ''}" onclick="Resumes.toggleAudit()">Interview safety</button>
            <button class="btn btn-ghost btn-danger" onclick="Resumes.resetToMaster()">Reset Preview to Master Resume</button>
          </div>
          ${state.showChanges ? changesPanel(plan) : ''}
          ${state.showDiff ? diffViewer(state.masterContent, plan, profile) : ''}
          ${state.showAudit && state.audit ? auditPanel(state.audit) : ''}` : '')
      : (master
        ? `<div class="doc-banner">${Icons.get('file', 12)} Master resume — imported from&nbsp;<b>${esc(master.name)}</b><button class="mlink" onclick="MasterResume.download()">Download original</button></div>`
        : `<div class="doc-banner neutral">${Icons.get('file', 12)} Master resume — rendered live from your <a href="#/profile" style="color:var(--accent); font-weight:600">&nbsp;Profile</a></div>`)
        + `<div class="intel-teaser">🛡 <b>Resume Intelligence:</b> hit <b>Generate Resume</b> (or Load a variant) to see the Safety Score, Changes Made, Master↔Tailored Difference Viewer, per-bullet Interview Safety audit and one-click Reset — the master is never modified.</div>`;

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
      resumeBody = docxNote + resumePaper(profile, variant, sugg ? sugg.matched : [], plan);
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

  /* keep tailored rendering consistent inside preview() */

  function render(state) {
    return `
      <p class="screen-intro">One master resume, generated live from your profile — tailored variants and cover letters per application. Download as PDF or copy as plain text for online forms.</p>
      <div class="doc-layout">
        <div class="doc-side">${workbench(state)}</div>
        ${preview(state)}
      </div>`;
  }

  return { render, resumePaper, coverPaper, rolesFrom };
})();
