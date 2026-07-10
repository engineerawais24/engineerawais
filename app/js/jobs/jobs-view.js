/* ============================================================
   JobsView — pure rendering for the Today's Jobs screen.
   Takes evaluated items ({job, res, status}), returns HTML.
   All events call methods on the Jobs controller.
   ============================================================ */

const JobsView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const LOGO_COLORS = ['#3538CD', '#1E7A4D', '#B7791F', '#B23A2E', '#0E7C7B', '#6B4EFF', '#2B579A'];

  const SRC_CLASS = {
    'LinkedIn': 'linkedin', 'Bayt': 'bayt',
    'GulfTalent': 'gulftalent', 'Company Careers': 'careers',
  };

  function scoreClass(score) {
    return score >= 85 ? 'hi' : score >= 72 ? 'mid' : 'low';
  }

  function monogram(company) {
    const idx = [...company].reduce((n, c) => n + c.charCodeAt(0), 0) % LOGO_COLORS.length;
    return `<div class="jlogo" style="background:${LOGO_COLORS[idx]}">${esc(company.trim()[0].toUpperCase())}</div>`;
  }

  function postedRel(iso) {
    const days = Math.max(0, Math.round((Date.now() - new Date(iso + 'T00:00:00')) / 864e5));
    return days === 0 ? 'Today' : days === 1 ? '1d ago' : days <= 14 ? days + 'd ago'
      : new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function salaryDisplay(job) {
    if (!job.salaryDisclosed) {
      return typeof job.salary === 'string' ? job.salary : 'Salary not disclosed';
    }
    const cur = job.currency === 'USD' ? '$' : job.currency + ' ';
    const sep = job.currency === 'USD' ? '–$' : '–';   // $185k–$215k · AED 540k–600k
    return job.salaryMax != null
      ? `${cur}${job.salary}k${sep}${job.salaryMax}k`
      : `${cur}${job.salary}k`;
  }

  /* the "why" — per-factor breakdown behind each score */
  function whyPanel(item) {
    const { job, res } = item;
    return `
      <div class="why-panel" id="why-${job.id}" hidden>
        ${res.factors.map(f => `
          <div class="wf">
            <div class="wf-top">
              <span class="wf-label ${f.gap ? 'gap' : ''}">${f.label}</span>
              <span class="wf-bar"><i style="width:${Math.round(f.points / f.max * 100)}%" class="${f.gap ? 'bad' : ''}"></i></span>
              <span class="wf-pts">${f.points}/${f.max}</span>
            </div>
            <div class="wf-note">${esc(f.note)}</div>
          </div>`).join('')}
        <div class="why-foot">Compared read-only against your master resume, employment history, skills, certifications, languages, preferences and work authorization.</div>
      </div>`;
  }

  function jobCard(item, hiddenGroup) {
    const { job, res, status } = item;
    const decided = status !== 'pending';
    const statusPill = {
      approved: '<span class="pill pill-green">Approved → tailoring queued</span>',
      rejected: '<span class="pill pill-red">Rejected</span>',
      later: '<span class="pill pill-amber">Saved for later</span>',
    }[status] || '';

    const chips =
      res.matched.slice(0, 4).map(r => `<span class="chip chip-yes">✓ ${esc(r)}</span>`).join('') +
      res.missing.slice(0, 2).map(m => `<span class="chip chip-no">△ ${esc(m)}</span>`).join('') +
      (job.visaSponsorship ? '<span class="chip chip-visa">🛂 Visa sponsorship</span>' : '');

    const actions = decided
      ? `<button class="btn btn-ghost" onclick="Jobs.undo('${job.id}')">Undo</button>`
      : `<button class="btn btn-green" onclick="Jobs.approve('${job.id}')">Approve</button>
         <button class="btn btn-amber" onclick="Jobs.later('${job.id}')">Later</button>
         <button class="btn btn-red" onclick="Jobs.reject('${job.id}')">Reject</button>`;

    const salaryPill = res.filtered
      ? `<span class="pill pill-red">Below salary preference</span>` : '';

    return `
      <div class="card job-card ${decided || hiddenGroup ? 'decided' : ''}" data-job="${job.id}">
        <div class="row">
          <div class="job-score ${scoreClass(res.score)}" title="Match score out of 100">
            <span class="n">${res.score}</span><span class="m">MATCH</span>
          </div>
          ${monogram(job.company)}
          <div style="flex:1; min-width:200px">
            <div class="job-head">
              <span class="jt">${esc(job.title)}</span>
              <span class="jc">· ${esc(job.company)}</span>
              <span class="src-badge ${SRC_CLASS[job.source] || ''}">${esc(job.source)}</span>
              <span class="jposted">${postedRel(job.postedDate)}</span>
              ${statusPill}${salaryPill}
            </div>
            <div class="job-meta">${esc(job.location)}${job.location.toLowerCase().includes(job.workMode.toLowerCase()) ? '' : ' · ' + esc(job.workMode)} · ${esc(job.employmentType)} · ${esc(salaryDisplay(job))}</div>
            <div class="job-desc">${esc(job.description)}</div>
            <div class="job-chips">${chips}</div>
            <div class="job-foot">
              <button class="why-btn" id="whyb-${job.id}" onclick="Jobs.toggleWhy('${job.id}')">Why ${res.score}?</button>
              <a class="apply-link" href="${esc(job.applyUrl)}" target="_blank" rel="noopener">View posting ↗</a>
            </div>
            ${whyPanel(item)}
          </div>
          <div class="job-actions">${actions}</div>
        </div>
      </div>`;
  }

  function render({ items, ui, minSalary }) {
    const visible = items.filter(x => !x.res.filtered);
    const hidden = items.filter(x => x.res.filtered);
    const bySource = s => (s === 'All' ? visible : visible.filter(x => x.job.source === s));
    const shown = bySource(ui.source);

    const approved = items.filter(x => x.status === 'approved').length;
    const rejected = items.filter(x => x.status === 'rejected').length;
    const pending = visible.filter(x => x.status === 'pending').length;

    const filters = ['All', ...JobsStore.SOURCES].map(s => `
      <button class="filter-chip ${ui.source === s ? 'active' : ''}" onclick="Jobs.setSource('${s}')">
        ${s} · ${s === 'All' ? visible.length : bySource(s).length}
      </button>`).join('');

    const hiddenBlock = hidden.length ? `
      <div class="card hidden-note">
        <div class="hn-row">
          <span class="hn-txt"><b>${hidden.length} job${hidden.length > 1 ? 's' : ''} hidden by your salary rule</b> — disclosed pay below your $${minSalary}k minimum. Undisclosed or “negotiable” salaries are never filtered.</span>
          <button class="btn btn-ghost" onclick="Jobs.toggleHidden()">${ui.showHidden ? 'Hide' : 'Show anyway'}</button>
        </div>
      </div>
      ${ui.showHidden ? `<div style="display:flex; flex-direction:column; gap:11px; margin-top:11px">${hidden.map(x => jobCard(x, true)).join('')}</div>` : ''}`
      : '';

    return `
      <p class="screen-intro">Sourced from LinkedIn, Bayt, GulfTalent and company career pages, normalized into one job model and scored 0–100 by the match engine against your full profile. Live crawling connects in the backend sprint. Your master resume is read <b>only</b> — approving queues a tailored <i>copy</i> for your sign-off.</p>
      <div class="jobs-summary">
        <span class="t">Today's jobs · ${items.length} sourced from ${JobsStore.SOURCES.length} boards</span>
        <div class="counts">
          <span style="color:var(--green)">✓ ${approved} approved</span>
          <span style="color:var(--red)">✕ ${rejected} rejected</span>
          <span style="color:var(--amber)">◷ ${pending} pending</span>
        </div>
      </div>
      <div class="filters">${filters}</div>
      <div style="display:flex; flex-direction:column; gap:11px">
        ${shown.map(x => jobCard(x, false)).join('')
          || '<div class="empty"><b>No jobs from this source today</b>Try another board filter.</div>'}
      </div>
      <div style="margin-top:14px">${hiddenBlock}</div>`;
  }

  return { render, scoreClass, salaryDisplay, postedRel };
})();
