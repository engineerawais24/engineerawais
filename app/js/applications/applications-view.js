/* ============================================================
   ApplicationsView — pure rendering for the Job Tracker board.
   Takes the card list, returns HTML strings. No state of its
   own; all events call methods on the Applications controller.
   ============================================================ */

const ApplicationsView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* Column definitions — single source for labels and colors,
     shared with the dashboard pipeline card via Applications. */
  const COLS = [
    { id: 'applied',   label: 'Applied',   dot: '#8B8272', color: 'var(--body)' },
    { id: 'interview', label: 'Interview', dot: '#3538CD', color: 'var(--accent)' },
    { id: 'offer',     label: 'Offer',     dot: '#1E7A4D', color: 'var(--green)' },
    { id: 'rejected',  label: 'Rejected',  dot: '#B23A2E', color: 'var(--red)' },
  ];

  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* Status badge is a styled <select>: shows the stage AND works
     as the move fallback on touch devices without HTML5 DnD. */
  function statusBadge(a) {
    return `
      <select class="kstatus s-${a.status}" title="Move to stage"
              onchange="Applications.setStatus('${a.id}', this.value)">
        ${COLS.map(c => `<option value="${c.id}" ${c.id === a.status ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>`;
  }

  function card(a) {
    return `
      <article class="kcard" draggable="true" data-id="${a.id}"
               ondragstart="Applications.dragStart(event,'${a.id}')"
               ondragend="Applications.dragEnd(event)">
        <div class="ktop">
          <div class="kco">${esc(a.company)}</div>
          ${statusBadge(a)}
        </div>
        <div class="kpos">${esc(a.position)}</div>
        <div class="kmeta">
          <span>${esc(a.location)}</span>
          <span class="kdate">Applied ${fmtDate(a.applied)}</span>
        </div>
      </article>`;
  }

  function column(col, items) {
    return `
      <section class="kcol">
        <header class="kcol-head">
          <span class="kdot" style="background:${col.dot}"></span>
          <span class="kname">${col.label}</span>
          <span class="kcount">${items.length}</span>
        </header>
        <div class="kbody" data-col="${col.id}"
             ondragover="Applications.dragOver(event)"
             ondragenter="Applications.dragEnter(event)"
             ondragleave="Applications.dragLeave(event)"
             ondrop="Applications.drop(event,'${col.id}')">
          ${items.map(card).join('') || '<div class="kempty">Drop applications here</div>'}
        </div>
      </section>`;
  }

  /* ---------- Sprint 23: application packages ----------
     Sits above the existing board; the board itself is unchanged. */

  function resumeOptions(pkg) {
    if (typeof ResumeRecommender === 'undefined') return '';
    const r = ResumeRecommender.forJob(pkg.job);
    if (!r) return '';
    return r.all.map(o => `<option value="${esc(o.id)}" ${o.id === pkg.resumeId ? 'selected' : ''}>
        ${o.id === r.recommended.id ? '★ ' : ''}${esc(o.name)} · ${o.confidence}%</option>`).join('');
  }

  /* ---------- Sprint 27: checklist + tailoring preview ---------- */

  function pkgChecklist(pkg) {
    if (typeof PackageBuilder === 'undefined') return '';
    const c = PackageBuilder.checklist(pkg);
    return `
      <div class="pkg-check">
        <div class="pc-head">
          <span class="pc-lbl">CHECKLIST</span>
          <div class="pc-bar"><i style="width:${c.progress}%"></i></div>
          <span class="pc-pct ${c.complete ? 'done' : ''}">${c.done}/${c.total} · ${c.progress}%</span>
        </div>
        <ul class="pc-items">
          ${c.items.map(i => `
            <li class="${i.done ? 'ok' : ''}">
              <span class="pc-box">${i.done ? '✓' : ''}</span>
              <span class="pc-name">${esc(i.label)}</span>
              <span class="pc-note">${esc(i.note)}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  function pkgTailoring(pkg) {
    if (typeof PackageBuilder === 'undefined') return '';
    const t = PackageBuilder.tailoringPreview(pkg.job);
    const chips = (list, cls) => list.map(s => `<span class="pt-chip ${cls}">${esc(s)}</span>`).join('');
    return `
      <div class="pkg-tailor">
        <span class="pt-lbl">RÉSUMÉ TAILORING · SUGGESTIONS ONLY — YOUR RÉSUMÉ IS NOT MODIFIED</span>
        <div class="pt-row"><span class="pt-k">Matched</span>
          <span class="pt-v">${t.matchedSkills.length ? chips(t.matchedSkills, 'ok') : '<i>None</i>'}</span></div>
        <div class="pt-row"><span class="pt-k">Missing</span>
          <span class="pt-v">${t.missingSkills.length ? chips(t.missingSkills, 'gap') : '<i>None</i>'}</span></div>
        <div class="pt-row"><span class="pt-k">Keywords</span>
          <span class="pt-v">${t.suggestedKeywords.length ? chips(t.suggestedKeywords, 'kw') : '<i>Nothing to add</i>'}</span></div>
        ${t.improvements.length ? `
          <div class="pt-row"><span class="pt-k">Improve</span>
            <span class="pt-v"><ul class="pt-tips">${t.improvements.map(i => `<li>${esc(i)}</li>`).join('')}</ul></span>
          </div>` : ''}
      </div>`;
  }

  function pkgDetail(pkg) {
    const j = pkg.job || {};
    const rows = [
      ['Role', j.title], ['Company', j.company], ['Location', j.location],
      ['Work mode', j.workMode], ['Type', j.employmentType], ['Source', j.source],
      ['Match score', pkg.matchScore == null ? '—' : pkg.matchScore + '%'],
      ['Résumé', pkg.resumeName || '—'],
      ['Approved', pkg.approvedOn],
      ['Status', ApplicationPackages.statusLabel(pkg.status)],
      ['Status changed', pkg.statusChangedOn],
    ].filter(([, v]) => v != null && v !== '');
    return `
      <div class="pkg-detail">
        <dl class="pkg-facts">
          ${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>
        ${pkg.jobSummary ? `<div class="pkg-summary">${esc(pkg.jobSummary)}</div>` : ''}
        ${(j.skills || []).length ? `<div class="pkg-skills">${j.skills.map(s => `<span class="pkg-skill">${esc(s)}</span>`).join('')}</div>` : ''}
        ${pkgChecklist(pkg)}
        ${pkgTailoring(pkg)}
        <pre class="pkg-cover">${esc(pkg.coverLetter || 'No cover letter in this package.')}</pre>
        ${j.applyUrl ? `<a class="pkg-link" href="${esc(j.applyUrl)}" target="_blank" rel="noopener">Open the original posting ↗</a>` : ''}
      </div>`;
  }

  /* Sprint 24: change the status straight from the Applications page */
  function statusOptions(pkg) {
    return ApplicationPackages.STATUSES.map(s =>
      `<option value="${s}" ${s === pkg.status ? 'selected' : ''}>${esc(ApplicationPackages.statusLabel(s))}</option>`
    ).join('');
  }

  function pkgCard(pkg, open) {
    /* once it has left "Ready to Apply" the package is a record of what was
       actually sent, so the résumé is no longer editable */
    const sent = pkg.status !== 'ready_to_apply';
    return `
      <article class="pkg ${sent ? 'is-applied' : ''}">
        <div class="pkg-top">
          <span class="pkg-co">${esc(pkg.job.company)}</span>
          <span class="pkg-pos">${esc(pkg.job.title)}</span>
          ${pkg.matchScore == null ? '' : `<span class="pkg-score">${pkg.matchScore}% match</span>`}
          <span class="pkg-chip s-${esc(pkg.status)}">${esc(ApplicationPackages.statusLabel(pkg.status))}</span>
        </div>
        <div class="pkg-meta">
          <span>Approved ${fmtDate(pkg.approvedOn)}</span>
          ${pkg.appliedOn ? `<span>· Applied ${fmtDate(pkg.appliedOn)}</span>` : ''}
          ${pkg.statusChangedOn ? `<span>· ${esc(ApplicationPackages.statusLabel(pkg.status))} ${fmtDate(pkg.statusChangedOn)}</span>` : ''}
          <span>· ${esc(pkg.resumeName || 'No résumé')}</span>
          ${typeof PackageBuilder !== 'undefined'
            ? (c => `<span class="pkg-prog ${c.complete ? 'done' : ''}">· Checklist ${c.done}/${c.total}</span>`)(PackageBuilder.checklist(pkg))
            : ''}
        </div>
        <div class="pkg-acts">
          <select class="pkg-status s-${esc(pkg.status)}" title="Change the application status"
                  onchange="Applications.setPackageStatus('${esc(pkg.id)}', this.value)">${statusOptions(pkg)}</select>
          <select class="pkg-resume" title="Change the selected résumé" ${sent ? 'disabled' : ''}
                  onchange="Applications.setPackageResume('${esc(pkg.id)}', this.value)">${resumeOptions(pkg)}</select>
          <button class="btn btn-ghost" onclick="Applications.openPackage('${esc(pkg.id)}')">${open ? 'Close' : 'Open package'}</button>
          <button class="btn btn-ghost" onclick="Applications.copyPackageCover('${esc(pkg.id)}')">Copy cover letter</button>
          <button class="btn btn-ghost" onclick="Applications.copyPackageSummary('${esc(pkg.id)}')">Copy summary</button>
          ${sent ? '' : `<button class="btn btn-primary" onclick="Applications.markApplied('${esc(pkg.id)}')">Mark as Applied</button>`}
        </div>
        ${open ? pkgDetail(pkg) : ''}
      </article>`;
  }

  function packages(list, openMap) {
    if (typeof ApplicationPackages === 'undefined') return '';
    const readyCount = list.filter(p => p.status === 'ready_to_apply').length;
    return `
      <section class="pkgs">
        <header class="pkgs-head">
          <span class="pkgs-title">Application packages</span>
          <span class="pkgs-count">${readyCount} ready to apply</span>
        </header>
        ${list.length
          ? list.map(p => pkgCard(p, !!(openMap && openMap[p.id]))).join('')
          : `<div class="pkgs-empty">Approve a job in Today’s Jobs and its package — résumé, cover letter and match score — appears here, ready to apply.</div>`}
      </section>`;
  }

  function render(items, ctx) {
    const c = ctx || {};
    return `
      <p class="screen-intro">Your pipeline at a glance. Drag cards between stages — or use the stage badge on any card. Changes are saved in this browser and reflected on the dashboard.</p>
      ${packages(c.packages || [], c.open)}
      <div class="kboard">
        ${COLS.map(c2 => column(c2, items.filter(a => a.status === c2.id))).join('')}
      </div>`;
  }

  return { render, COLS };
})();
