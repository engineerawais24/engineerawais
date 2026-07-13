/* ============================================================
   ImportView — the Import Job form and the imported-job cards
   (Sprint 26).

   Pure rendering. It sits INSIDE the existing Today's Jobs screen,
   above the sourced board, and uses the design system that is already
   there (.field / .req / .ferr / .btn / .chip). No modal, no new
   navigation, no change to the existing job card.
   ============================================================ */

const ImportView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const SOURCES = ['', 'LinkedIn', 'Bayt', 'GulfTalent', 'Indeed', 'Company Careers'];

  function fieldError(err) {
    return err ? `<div class="ferr">${esc(err)}</div>` : '';
  }

  function text({ name, label, value, err, req, half, ph, type }) {
    return `
      <div class="field ${half ? 'half' : ''}">
        <label>${esc(label)}${req ? ' <b class="req">*</b>' : ''}</label>
        <input type="${type || 'text'}" value="${esc(value || '')}" placeholder="${esc(ph || '')}"
               class="${err ? 'err' : ''}" oninput="Imports.setField('${name}', this.value)">
        ${fieldError(err)}
      </div>`;
  }

  function select({ name, label, value, options, half }) {
    return `
      <div class="field ${half ? 'half' : ''}">
        <label>${esc(label)}</label>
        <select onchange="Imports.setField('${name}', this.value)">
          ${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o || 'Imported (no source)')}</option>`).join('')}
        </select>
      </div>`;
  }

  /* ---------- Sprint 30: the salary block ----------
     A posting states its own currency and period. Nothing here estimates or
     converts — the figures are stored exactly as typed. Shared by the import
     form and the "Edit salary" editors. */
  function salaryFields(f, e, opts) {
    const o = opts || {};
    const idArg = o.id ? `'${esc(o.id)}', ` : '';
    const set = k => `${o.set}(${idArg}'${k}', this.value)`;
    const toggle = `${o.toggle}(${idArg}this.checked)`;

    const off = !!f.salaryNotDisclosed;
    const period = f.salaryPeriod || 'month';
    const hint = period === 'month'
      ? 'Amount per month — e.g. 32000'
      : 'Annual, in thousands — e.g. 185 means 185k';

    return `
      <div class="imp-salary">
        <div class="imp-sal-head">
          <span class="jb-lbl">SALARY</span>
          <label class="jb-check">
            <input type="checkbox" ${off ? 'checked' : ''} onchange="${toggle}">
            Salary not disclosed
          </label>
        </div>
        <div class="imp-sal-grid ${off ? 'is-off' : ''}">
          <div class="field">
            <label>Minimum</label>
            <input type="number" value="${esc(f.salaryMin == null ? '' : f.salaryMin)}" ${off ? 'disabled' : ''}
                   class="${e.salary ? 'err' : ''}" oninput="${set('salaryMin')}">
            ${fieldError(e.salary)}
          </div>
          <div class="field">
            <label>Maximum <span class="imp-opt">(optional)</span></label>
            <input type="number" value="${esc(f.salaryMax == null ? '' : f.salaryMax)}" ${off ? 'disabled' : ''}
                   class="${e.salaryMax ? 'err' : ''}" oninput="${set('salaryMax')}">
            ${fieldError(e.salaryMax)}
          </div>
          <div class="field">
            <label>Currency</label>
            <select ${off ? 'disabled' : ''} class="${e.currency ? 'err' : ''}" onchange="${set('currency')}">
              ${ImportedJobs.CURRENCIES.map(c =>
                `<option value="${esc(c)}" ${c === (f.currency || 'SAR') ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
            ${fieldError(e.currency)}
          </div>
          <div class="field">
            <label>Period</label>
            <select ${off ? 'disabled' : ''} class="${e.salaryPeriod ? 'err' : ''}" onchange="${set('salaryPeriod')}">
              ${ImportedJobs.PERIODS.map(pr =>
                `<option value="${esc(pr.id)}" ${pr.id === period ? 'selected' : ''}>${esc(pr.label)}</option>`).join('')}
            </select>
            ${fieldError(e.salaryPeriod)}
          </div>
        </div>
        ${off ? '' : `<div class="hint">${esc(hint)} · stored exactly as typed — never converted.</div>`}
      </div>`;
  }

  function form(ui) {
    const f = ui.form || {};
    const e = ui.errors || {};
    return `
      <div class="imp-form">
        <div class="imp-grid">
          ${text({ name: 'url', label: 'Job URL', value: f.url, err: e.url, req: true, ph: 'https://company.com/careers/solutions-engineer' })}
          ${text({ name: 'title', label: 'Job title', value: f.title, err: e.title, req: true, half: true, ph: 'Senior Solutions Engineer' })}
          ${text({ name: 'company', label: 'Company', value: f.company, err: e.company, req: true, half: true, ph: 'Acme' })}
          ${text({ name: 'location', label: 'Location', value: f.location, err: e.location, half: true, ph: 'Dubai, United Arab Emirates' })}
          ${select({ name: 'workplaceType', label: 'Workplace type', value: f.workplaceType || 'On Site', options: ImportedJobs.WORKPLACES, half: true })}
          ${select({ name: 'source', label: 'Job source', value: f.source || '', options: SOURCES, half: true })}
          ${text({ name: 'postedDate', label: 'Posted date (optional)', value: f.postedDate, err: e.postedDate, half: true, type: 'date' })}
        </div>
        ${salaryFields(f, e, { set: 'Imports.setField', toggle: 'Imports.toggleUndisclosed' })}
        <div class="field">
          <label>Job description <b class="req">*</b></label>
          <textarea rows="5" class="${e.description ? 'err' : ''}" placeholder="Paste the posting text. Required skills are read from it."
                    oninput="Imports.setField('description', this.value)">${esc(f.description || '')}</textarea>
          ${fieldError(e.description)}
        </div>
        <div class="imp-actions">
          <button class="btn btn-primary" onclick="Imports.submit()">Save job</button>
          <button class="btn btn-ghost" onclick="Imports.toggleForm()">Cancel</button>
          <span class="hint">The page behind the URL is never fetched — everything here is what you paste.</span>
        </div>
      </div>`;
  }

  /* ---------- an imported job card ---------- */

  function scoreClass(n) { return n >= 75 ? 'hi' : n >= 50 ? 'mid' : 'low'; }

  function statusOptions(job) {
    return ImportedJobs.STATUSES.map(s =>
      `<option value="${s}" ${s === job.status ? 'selected' : ''}>${esc(ImportedJobs.statusLabel(s))}</option>`
    ).join('');
  }

  /* the salary exactly as the posting states it */
  function salaryPill(job) {
    if (typeof PackageBuilder === 'undefined') return '';
    const info = PackageBuilder.salaryInfo(ImportedJobs.toBoardJob(job));
    return `<span class="imp-sal-pill s-${esc(info.status)}" title="${esc(info.label)}">· ${esc(info.text)}</span>`;
  }

  function card(job, m, open) {
    const applied = ImportedJobs.hasApplication(job.id);
    const pct = m ? m.percentage : 0;
    return `
      <article class="imp-card s-${esc(job.status)}">
        <div class="imp-top">
          <span class="imp-score ${scoreClass(pct)}">${pct}%</span>
          <span class="imp-co">${esc(job.company)}</span>
          <span class="imp-title">${esc(job.title)}</span>
          <span class="imp-chip s-${esc(job.status)}">${esc(ImportedJobs.statusLabel(job.status))}</span>
        </div>
        <div class="imp-meta">
          <span>${esc(job.location || 'Location not given')}</span>
          <span>· ${esc(job.workplaceType)}</span>
          <span>· ${esc(job.source)}</span>
          <span>· Imported ${esc(job.createdOn)}</span>
          ${salaryPill(job)}
        </div>
        ${m ? `<div class="imp-why">${esc(ImportedJobs.explain(m))}</div>` : ''}
        ${m ? `
          <div class="imp-skills">
            ${m.matchedSkills.map(s => `<span class="imp-skill ok">${esc(s)}</span>`).join('')}
            ${m.missingSkills.map(s => `<span class="imp-skill gap">${esc(s)}</span>`).join('')}
            ${!m.matchedSkills.length && !m.missingSkills.length
              ? '<span class="imp-skill">No known skills found in the description</span>' : ''}
          </div>` : ''}
        <div class="imp-acts">
          <select class="imp-status" title="Review status"
                  onchange="Imports.setStatus('${esc(job.id)}', this.value)">${statusOptions(job)}</select>
          <button class="btn btn-ghost" onclick="Imports.toggleDetails('${esc(job.id)}')">${open ? 'Hide details' : 'Details'}</button>
          <a class="btn btn-ghost" href="${esc(job.url)}" target="_blank" rel="noopener">Open posting ↗</a>
          ${job.status === 'approved'
            ? (applied
              ? '<span class="imp-done">✓ Application created</span>'
              : `<button class="btn btn-primary" onclick="Imports.createApplication('${esc(job.id)}')">Create Application</button>`)
            : ''}
        </div>
        ${open ? `
          <div class="imp-detail">
            <dl class="imp-facts">
              ${[['Match', m ? m.percentage + '%' : '—'],
                 ['Matched skills', m && m.matchedSkills.length ? m.matchedSkills.join(', ') : 'None'],
                 ['Missing skills', m && m.missingSkills.length ? m.missingSkills.join(', ') : 'None'],
                 ['Salary', (typeof PackageBuilder !== 'undefined') ? PackageBuilder.salaryText(ImportedJobs.toBoardJob(job)) : 'Not given'],
                 ['Posted', job.postedDate || 'Not given'],
                 ['Status changed', job.statusChangedOn || '—']]
                .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
            </dl>
            <pre class="imp-desc">${esc(job.description)}</pre>
          </div>` : ''}
      </article>`;
  }

  /* ---------- the section inside Today's Jobs ---------- */

  function section(ui, jobs, matches) {
    const u = ui || {};
    const list = jobs || [];
    const rejectedCount = ImportedJobs.rejected().length;
    return `
      <section class="imports">
        <header class="imp-head">
          <span class="imp-h-title">Imported jobs</span>
          <span class="imp-h-count">${list.length} ${u.showRejected ? 'rejected' : 'active'}</span>
          ${rejectedCount ? `
            <button class="filter-chip ${u.showRejected ? 'active' : ''}" onclick="Imports.toggleRejected()">
              ${u.showRejected ? 'Back to active' : `Rejected · ${rejectedCount}`}
            </button>` : ''}
          <button class="btn ${u.formOpen ? 'btn-ghost' : 'btn-primary'}" onclick="Imports.toggleForm()">
            ${u.formOpen ? 'Close' : 'Import job'}
          </button>
        </header>
        ${u.formOpen ? form(u) : ''}
        ${list.length
          ? `<div class="imp-list">${list.map(j => card(j, matches[j.id], !!(u.open && u.open[j.id]))).join('')}</div>`
          : (u.formOpen ? '' : `<div class="imp-empty">${u.showRejected
              ? 'No rejected jobs.'
              : 'Paste a real job you found anywhere — it is scored against your profile, then follows the same review → approve → application flow.'}</div>`)}
      </section>`;
  }

  return { section, form, card, salaryFields, salaryPill, SOURCES };
})();
