/* ============================================================
   ParsingView — the parsing status strip on the Résumé Library and
   the review-and-approve screen (Sprint 28).

   Pure rendering, on the existing design system (.card / .field /
   .btn / .chip). The Résumé Library keeps its layout: the strip is
   added above it, nothing is moved.
   ============================================================ */

const ParsingView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- the status strip (Résumé Library) ---------- */

  function statusStrip() {
    if (typeof ParsedResume === 'undefined') return '';
    const rec = ParsedResume.load();
    const file = (typeof MasterResume !== 'undefined') ? MasterResume.get() : null;
    const busy = rec.status === 'parsing';

    const actions = [];
    if (file && (rec.status === 'not_parsed' || rec.status === 'failed')) {
      actions.push(`<button class="btn btn-primary" onclick="ResumeParsing.parse()" ${busy ? 'disabled' : ''}>Parse résumé</button>`);
    }
    if (rec.status === 'needs_review' || rec.status === 'approved') {
      actions.push(`<button class="btn btn-primary" onclick="location.hash='#/resumeReview'">${rec.status === 'approved' ? 'View parsed data' : 'Review parsed data'}</button>`);
      actions.push(`<button class="btn btn-ghost" onclick="ResumeParsing.reparse()">Re-parse</button>`);
    }

    const note = rec.status === 'failed'
      ? `<div class="rp-err">${esc(rec.error || 'Parsing failed')}</div>`
      : rec.status === 'needs_review'
        ? `<div class="rp-note">${rec.completeness}% extracted${rec.missing.length ? ` · not found: ${esc(rec.missing.join(', '))}` : ''} — review it before it touches your profile.</div>`
        : rec.status === 'approved'
          ? `<div class="rp-note ok">Approved — your profile, matching, résumé recommendation and cover letters now use this résumé.</div>`
          : file
            ? `<div class="rp-note">Parsed locally in your browser. Your résumé is never uploaded anywhere.</div>`
            : `<div class="rp-note">Upload a master résumé on the Profile page to parse it.</div>`;

    return `
      <section class="rp-strip">
        <div class="rp-row">
          <span class="rp-lbl">MASTER RÉSUMÉ</span>
          <span class="rp-chip s-${esc(rec.status)}">${esc(ParsedResume.statusLabel(rec.status))}</span>
          <span class="rp-file">${file ? esc(file.name) : 'No file uploaded'}</span>
          <span class="rp-spacer"></span>
          ${actions.join('')}
        </div>
        ${note}
        ${recoveryPanel()}
      </section>`;
  }

  /* ---------- certification recovery (preview, then confirm) ---------- */

  function recoveryPanel() {
    if (typeof CertRecovery === 'undefined' || typeof ResumeParsing === 'undefined') return '';
    const plan = CertRecovery.preview();
    if (!plan.available) return '';                    // nothing missing → say nothing
    const open = !!ResumeParsing.ui.recoveryOpen;

    if (!open) {
      return `
        <div class="rp-recover">
          <b>${plan.toRestore.length} certification${plan.toRestore.length === 1 ? '' : 's'} can be recovered</b>
          from a saved résumé variant — ${esc(plan.toRestore.map(c => c.name).join(', '))}.
          <button class="btn btn-primary" onclick="ResumeParsing.previewRecovery()">Preview recovery</button>
        </div>`;
    }

    return `
      <div class="rp-recover open">
        <div class="rp-rec-head">
          <b>Recover certifications</b>
          <span class="rp-meta">from the “${esc(plan.source.company)} — ${esc(plan.source.title)}” variant · ${plan.source.count} saved</span>
          <span class="rp-spacer"></span>
          <button class="btn btn-ghost" onclick="ResumeParsing.closeRecovery()">Close</button>
        </div>

        <div class="rp-rec-row">
          <span class="rp-k">Existing (kept)</span>
          <span class="rp-v">${plan.existing.length
            ? esc(plan.existing.map(c => c.name).join(', '))
            : '<i>none</i>'}</span>
        </div>
        <div class="rp-rec-row">
          <span class="rp-k">To restore</span>
          <span class="rp-v rp-plus">+ ${esc(plan.toRestore.map(c => `${c.name}${c.issuer ? ` — ${c.issuer}` : ''}${c.year ? ` (${c.year})` : ''}`).join(', '))}</span>
        </div>
        <div class="rp-rec-row">
          <span class="rp-k">Duplicates skipped</span>
          <span class="rp-v">${plan.duplicates.length
            ? esc(plan.duplicates.map(d => `${d.found} → already held as “${d.kept}”`).join(' · '))
            : '<i>none</i>'}</span>
        </div>

        <div class="rp-rec-foot">
          <button class="btn btn-primary" onclick="ResumeParsing.applyRecovery()">
            Restore ${plan.toRestore.length} certification${plan.toRestore.length === 1 ? '' : 's'}
          </button>
          <span class="rp-meta">Nothing is written until you press this. Existing certifications are never removed,
            and no other profile field is touched.</span>
        </div>
      </div>`;
  }

  /* ---------- the review screen ---------- */

  function field(label, path, value, half) {
    return `
      <div class="field ${half ? 'half' : ''}">
        <label>${esc(label)}</label>
        <input type="text" value="${esc(value || '')}" oninput="ResumeParsing.setField('${path}', this.value)">
      </div>`;
  }

  function skillsBlock(d) {
    return `
      <div class="rp-block">
        <h3>Skills <span class="rp-count">${d.skills.length}</span></h3>
        <div class="rp-skills">
          ${d.skills.map(s => `
            <span class="rp-skill">${esc(s)}
              <button title="Remove" onclick="ResumeParsing.removeSkill('${esc(s).replace(/'/g, "\\'")}')">×</button>
            </span>`).join('') || '<i class="rp-none">No skills were found — add them below.</i>'}
        </div>
        <div class="rp-add">
          <input type="text" id="rp-skill-new" placeholder="Add a skill the parser missed">
          <button class="btn btn-ghost" onclick="ResumeParsing.addSkill()">Add skill</button>
        </div>
      </div>`;
  }

  function employmentBlock(d) {
    return `
      <div class="rp-block">
        <h3>Employment history <span class="rp-count">${d.employment.length}</span></h3>
        ${d.employment.map((r, i) => `
          <div class="rp-emp">
            <div class="rp-emp-grid">
              <div class="field half"><label>Title</label>
                <input type="text" value="${esc(r.title)}" oninput="ResumeParsing.setEmployment(${i}, 'title', this.value)"></div>
              <div class="field half"><label>Company</label>
                <input type="text" value="${esc(r.company)}" oninput="ResumeParsing.setEmployment(${i}, 'company', this.value)"></div>
              <div class="field half"><label>From</label>
                <input type="text" value="${esc(r.startDate)}" placeholder="2021-03" oninput="ResumeParsing.setEmployment(${i}, 'startDate', this.value)"></div>
              <div class="field half"><label>To</label>
                <input type="text" value="${esc(r.current ? 'Present' : r.endDate)}" placeholder="2023-01" oninput="ResumeParsing.setEmployment(${i}, 'endDate', this.value)"></div>
            </div>
            ${r.bullets.length ? `<ul class="rp-bullets">${r.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
            <div class="rp-emp-foot">
              <span class="rp-meta">${r.achievements.length} achievement${r.achievements.length === 1 ? '' : 's'} · ${r.responsibilities.length} responsibilit${r.responsibilities.length === 1 ? 'y' : 'ies'}</span>
              <button class="btn btn-ghost" onclick="ResumeParsing.removeEmployment(${i})">Remove role</button>
            </div>
          </div>`).join('') || '<i class="rp-none">No employment history was found. Add it on the Profile page, or re-parse a cleaner file.</i>'}
      </div>`;
  }

  function certsBlock(d) {
    return `
      <div class="rp-block">
        <h3>Certifications <span class="rp-count">${d.certifications.length}</span></h3>
        ${d.certifications.map((c, i) => `
          <div class="rp-cert">
            <div class="field half"><label>Name</label>
              <input type="text" value="${esc(c.name)}" oninput="ResumeParsing.setCertification(${i}, 'name', this.value)"></div>
            <div class="field half"><label>Issuer</label>
              <input type="text" value="${esc(c.issuer)}" oninput="ResumeParsing.setCertification(${i}, 'issuer', this.value)"></div>
            <div class="field half"><label>Year</label>
              <input type="text" value="${esc(c.year)}" oninput="ResumeParsing.setCertification(${i}, 'year', this.value)"></div>
            <button class="btn btn-ghost" onclick="ResumeParsing.removeCertification(${i})">Remove</button>
          </div>`).join('') || '<i class="rp-none">No certifications were found.</i>'}
        <div class="rp-add">
          <input type="text" id="rp-cert-new" placeholder="Add a certification the parser missed">
          <button class="btn btn-ghost" onclick="ResumeParsing.addCertification()">Add certification</button>
        </div>
      </div>`;
  }

  function educationBlock(d) {
    if (!d.education.length) return '';
    return `
      <div class="rp-block">
        <h3>Education <span class="rp-count">${d.education.length}</span></h3>
        <ul class="rp-bullets">
          ${d.education.map(e => `<li>${esc(e.degree)}${e.school ? ` — ${esc(e.school)}` : ''}${e.year ? ` (${esc(e.year)})` : ''}</li>`).join('')}
        </ul>
      </div>`;
  }

  /* the comparison: nothing is written until these are confirmed */
  function comparison(rows, selected) {
    const changed = rows.filter(r => r.changed);
    const show = v => Array.isArray(v)
      ? (v.length ? esc(v.join(', ')) : '<i>—</i>')
      : (String(v || '').trim() ? esc(v) : '<i>—</i>');

    /* Skills and certifications are additive — the row spells out what is
       kept, what the résumé turned up, and what would actually be added.
       Nothing is ever marked for removal. */
    const additiveCell = r => `
      <div class="rp-add-cell">
        <div><span class="rp-k">Kept</span> ${r.kept.length ? `<span class="rp-keep">${esc(r.kept.join(', '))}</span>` : '<i>—</i>'}</div>
        <div><span class="rp-k">Detected</span> ${show(r.parsed)}</div>
        <div><span class="rp-k">Will be added</span> ${r.additions.length
          ? `<span class="rp-plus">+ ${esc(r.additions.join(', '))}</span>`
          : '<i>nothing new</i>'}</div>
        <div class="rp-never">Nothing is removed — your existing entries are always kept.</div>
      </div>`;

    if (!changed.length) {
      return `<div class="rp-same">Your profile already has everything in the parsed résumé — there is nothing to add.</div>`;
    }
    return `
      <table class="rp-diff">
        <thead><tr><th></th><th>Field</th><th>Currently in your profile</th><th>From your résumé</th></tr></thead>
        <tbody>
          ${changed.map(r => `
            <tr class="${selected[r.path] ? 'on' : 'off'}">
              <td><input type="checkbox" ${selected[r.path] ? 'checked' : ''}
                         onchange="ResumeParsing.toggleApply('${r.path}')"></td>
              <td class="rp-f">${esc(r.label)}${r.additive ? '<span class="rp-tag">adds only</span>' : ''}</td>
              ${r.additive
                ? `<td class="rp-cur" colspan="2">${additiveCell(r)}</td>`
                : `<td class="rp-cur">${show(r.current)}</td><td class="rp-new">${show(r.parsed)}</td>`}
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* an offer to put back anything that went missing before this fix */
  function restoreBanner() {
    if (typeof ParsedResume === 'undefined') return '';
    const missing = ParsedResume.restorableCertifications();
    if (!missing.length) return '';
    return `
      <div class="rp-restore">
        <b>${missing.length} certification${missing.length === 1 ? '' : 's'} you had before parsing ${missing.length === 1 ? 'is' : 'are'} no longer in your profile:</b>
        ${esc(missing.map(c => c.name).join(', '))}
        <button class="btn btn-primary" onclick="ResumeParsing.restoreCertifications()">Restore ${missing.length === 1 ? 'it' : 'them'}</button>
      </div>`;
  }

  function review(rec, selected) {
    if (!rec || !rec.data) {
      return `<div class="empty"><b>Nothing has been parsed yet</b>Upload a master résumé and parse it from the Résumé Library.</div>`;
    }
    const d = rec.data;
    const rows = ParsedResume.diff();
    const chosen = rows.filter(r => r.changed && selected[r.path]).length;
    const approved = rec.status === 'approved';

    return `
      <p class="screen-intro">
        Everything below was read from <b>${esc((rec.sourceFile && rec.sourceFile.name) || 'your master résumé')}</b> in your browser —
        it was never uploaded anywhere, and the file itself has not been modified.
        Correct anything the parser got wrong, then choose what to apply to your profile.
      </p>

      <div class="rp-head">
        <span class="rp-chip s-${esc(rec.status)}">${esc(ParsedResume.statusLabel(rec.status))}</span>
        <span class="rp-note">${rec.completeness}% extracted${rec.missing.length ? ` · not found: ${esc(rec.missing.join(', '))}` : ''}</span>
        <span class="rp-spacer"></span>
        <button class="btn btn-ghost" onclick="location.hash='#/resumes'">Back to the library</button>
      </div>

      <div class="card rp-card">
        <h3>Personal details</h3>
        <div class="rp-grid">
          ${field('Full name', 'personal.fullName', d.personal.fullName, true)}
          ${field('Professional title', 'personal.title', d.personal.title, true)}
          ${field('Email', 'contact.email', d.contact.email, true)}
          ${field('Phone', 'contact.phone', d.contact.phone, true)}
          ${field('City', 'contact.city', d.contact.city, true)}
          ${field('Country', 'contact.country', d.contact.country, true)}
        </div>
        <div class="field">
          <label>Professional summary</label>
          <textarea rows="3" oninput="ResumeParsing.setField('personal.summary', this.value)">${esc(d.personal.summary)}</textarea>
        </div>
        <div class="rp-meta">Total experience: <b>${d.totalYears != null ? d.totalYears + ' years' : 'not found'}</b>
          · Target roles: <b>${esc(d.roleKeywords.join(', ') || '—')}</b></div>
      </div>

      <div class="card rp-card">${skillsBlock(d)}</div>
      <div class="card rp-card">${employmentBlock(d)}</div>
      <div class="card rp-card">${certsBlock(d)}${educationBlock(d)}</div>

      <div class="card rp-card">
        <h3>Apply to your profile</h3>
        <p class="rp-lead">
          Nothing is written until you confirm it. Skills and certifications are only ever <b>added</b> —
          nothing you already have is removed, even if the parser did not spot it. Your own profile edits always win.
        </p>
        ${restoreBanner()}
        ${comparison(rows, selected)}
        <div class="rp-actions">
          <button class="btn btn-primary" onclick="ResumeParsing.approve()" ${chosen || !rows.some(r => r.changed) ? '' : 'disabled'}>
            ${approved ? 'Re-apply' : 'Approve'} ${chosen ? `and apply ${chosen} field${chosen === 1 ? '' : 's'}` : ''}
          </button>
          ${approved ? `<button class="btn btn-ghost" onclick="ResumeParsing.reopen()">Edit again</button>` : ''}
          <span class="rp-meta">${approved
            ? 'Approved — placeholder data is no longer used anywhere.'
            : 'Approving switches your cover letters and packages over to this résumé.'}</span>
        </div>
      </div>`;
  }

  return { statusStrip, review, comparison, restoreBanner, recoveryPanel };
})();
