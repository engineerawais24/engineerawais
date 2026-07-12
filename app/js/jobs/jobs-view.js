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

  /* the controller's ui state for the current render (Sprint 22 needs it
     inside jobCard, which is called without it) */
  let _ui = {};

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

  /* returns HTML: monthly amounts are absolute, yearly in thousands;
     a null undisclosed salary gets an explicit "Not disclosed" pill */
  function salaryDisplay(job) {
    if (!job.salaryDisclosed) {
      return typeof job.salary === 'string'
        ? esc(job.salary)
        : '<span class="nd-pill">Not disclosed</span>';
    }
    const cur = job.currency === 'USD' ? '$' : job.currency + ' ';
    if (job.salaryPeriod === 'month') {
      const fmtN = n => Number(n).toLocaleString('en-US');
      return job.salaryMax != null
        ? `${cur}${fmtN(job.salary)}–${fmtN(job.salaryMax)}/mo`
        : `${cur}${fmtN(job.salary)}/mo`;
    }
    const sep = job.currency === 'USD' ? '–$' : '–';   // $185k–$215k · AED 540k–600k
    return job.salaryMax != null
      ? `${cur}${job.salary}k${sep}${job.salaryMax}k`
      : `${cur}${job.salary}k`;
  }

  /* Sprint 20: the score breakdown + short match reasons, shown in the
     existing match-score area of the card. Guarded so an older result
     object (without a breakdown) still renders exactly as before. */
  function scoreBreakdown(res) {
    const b = res && res.breakdown;
    if (!b) return '';
    const bar = (label, part) => {
      const pct = part.max ? Math.round((part.points / part.max) * 100) : 0;
      const cls = pct >= 80 ? 'hi' : pct >= 50 ? 'mid' : 'low';
      return `<span class="bd ${cls}" title="${esc(label)} ${part.points} of ${part.max}">
        <i>${esc(label)}</i><b>${part.points}/${part.max}</b></span>`;
    };
    return `
      <div class="job-breakdown">
        <span class="bd overall"><i>Match</i><b>${b.overall}/100</b></span>
        ${bar('Skills', b.skills)}${bar('Experience', b.experience)}${bar('Location', b.location)}${bar('Salary', b.salary)}
      </div>`;
  }

  function matchReasons(res) {
    const rs = (res && res.matchReasons) || [];
    if (!rs.length) return '';
    return `<div class="job-reasons">${rs.map(r => `<span class="rchip">✓ ${esc(r)}</span>`).join('')}</div>`;
  }

  /* Sprint 21: the recommended résumé for this job, with a manual
     override. Guarded — if the recommender isn't loaded the card renders
     exactly as before. Nothing here submits or modifies a résumé. */
  function resumeRec(job) {
    if (typeof ResumeRecommender === 'undefined') return '';
    const r = ResumeRecommender.forJob(job);
    if (!r) return '';
    const sel = r.selected;
    const cls = sel.confidence >= 80 ? 'hi' : sel.confidence >= 55 ? 'mid' : 'low';
    const options = r.all.map(o => `
      <option value="${esc(o.id)}" ${o.id === sel.id ? 'selected' : ''}>
        ${o.id === r.recommended.id ? '★ ' : ''}${esc(o.name)} · ${o.confidence}%
      </option>`).join('');
    return `
      <div class="job-resume">
        <span class="jr-lbl">RÉSUMÉ</span>
        <select class="jr-sel" onchange="Jobs.setResume('${esc(job.id)}', this.value)">${options}</select>
        <span class="jr-conf ${cls}">${sel.confidence}% confidence</span>
        ${r.overridden
        ? `<button class="jr-reset" onclick="Jobs.setResume('${esc(job.id)}','')" title="Back to the recommendation">manual · reset</button>`
        : '<span class="jr-tag">recommended</span>'}
        <span class="jr-why">${esc(sel.reason)}</span>
      </div>`;
  }

  /* Sprint 22: the tailored cover letter for this job. Guarded — if the
     generator isn't loaded the card renders exactly as before. Nothing
     here submits anything; the letter is a local draft. */
  function coverLetter(job, ui) {
    if (typeof CoverLetter === 'undefined') return '';
    const l = CoverLetter.get(job.id);
    if (!l) {
      return `
        <div class="job-cover">
          <span class="jc-lbl">COVER LETTER</span>
          <button class="btn btn-ghost jc-btn" onclick="Jobs.generateCover('${esc(job.id)}')">Generate cover letter</button>
          <span class="jc-hint">Template-based draft from your profile and the selected résumé — nothing is sent.</span>
        </div>`;
    }
    const open = !!(ui.coverOpen && ui.coverOpen[job.id]);
    return `
      <div class="job-cover">
        <span class="jc-lbl">COVER LETTER</span>
        <button class="btn btn-ghost jc-btn" onclick="Jobs.toggleCover('${esc(job.id)}')">${open ? 'Hide preview' : 'Preview'}</button>
        <button class="btn btn-ghost jc-btn" onclick="Jobs.copyCover('${esc(job.id)}')">Copy</button>
        <button class="btn btn-ghost jc-btn" onclick="Jobs.regenerateCover('${esc(job.id)}')">Regenerate</button>
        <span class="jc-meta">Using <b>${esc(l.resumeName || 'your résumé')}</b>${l.matchedSkills && l.matchedSkills.length ? ` · ${l.matchedSkills.length} matching skill${l.matchedSkills.length === 1 ? '' : 's'}` : ''}</span>
        ${open ? `<pre class="jc-preview">${esc(l.text)}</pre>` : ''}
      </div>`;
  }

  const REC_CLASS = {
    'Must Apply': 'must', 'Strong Match': 'strong', 'Good Match': 'good',
    'Review Manually': 'review', 'Skip': 'skip',
  };

  /* decision block — outcome + confidence + ✓/✗ explanation */
  function decisionSection(item) {
    const d = item.decision;
    if (!d) return '';
    const because = d.outcome === 'reject' ? 'Rejected because:'
      : d.outcome === 'auto_approve' ? 'Accepted because:'
        : 'Sent for manual review because:';
    return `
      <div class="dec-sec ${d.outcome}">
        <div class="dec-line"><b>${d.outcomeLabel}</b> · ${d.recommendation} · ${d.confidence} confidence · Decision score ${d.score}</div>
        <div class="dec-because">${because}</div>
        ${d.reasons.map(r => `<div class="dec-row ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${esc(r.text)}</div>`).join('')}
      </div>`;
  }

  /* the "Why ranked here?" panel — tier + adjustments + factors */
  function rankSection(item) {
    const { res, rank } = item;
    if (!rank) return '';
    const sign = n => (n > 0 ? '+' : '−') + Math.abs(n);
    return `
      <div class="rank-sec">
        <div class="rank-line"><b>Why ranked here?</b> Match ${res.score}${rank.boost ? ` · Boost ${sign(rank.boost)}` : ''} → Rank score ${rank.rankScore} · ${rank.tierLabel}</div>
        ${rank.adjustments.map(a => `
          <div class="rank-row">
            <span class="rl">${a.label}</span>
            <span class="rp ${a.pts >= 0 ? 'pos' : 'neg'}">${sign(a.pts)}</span>
          </div>`).join('')}
        ${!rank.adjustments.length ? '<div class="rank-row"><span class="rl">No ranking adjustments — ordered by match score alone</span></div>' : ''}
      </div>`;
  }

  function whyPanel(item) {
    const { job, res } = item;
    return `
      <div class="why-panel" id="why-${job.id}" hidden>
        ${decisionSection(item)}
        ${rankSection(item)}
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
        <div class="why-meta">${esc(job.originalSource)} · id ${esc(job.sourceJobId)} · ${esc(job.canonicalUrl)}${job.duplicateGroupId ? ' · dedupe ' + esc(job.duplicateGroupId) : ''} · first seen ${esc(job.firstDiscovered)} · last checked ${esc(job.lastChecked)}</div>
      </div>`;
  }

  function jobCard(item, hiddenGroup) {
    const { job, res, rank, decision, status } = item;
    const recBadge = decision
      ? `<span class="rec-badge ${REC_CLASS[decision.recommendation] || 'review'}" title="${esc(decision.outcomeLabel)} · ${esc(decision.confidence)} confidence — open “Why ranked here?” for the full explanation">${esc(decision.recommendation)}</span>`
      : '';
    const rankBadges = rank ? (
      (rank.tier < 3 ? `<span class="tier-badge t${rank.tier}" title="${esc(rank.tierLabel)}">T${rank.tier}</span>` : '') +
      (rank.boost ? `<span class="boost-badge ${rank.boost < 0 ? 'neg' : ''}" title="Ranking boost applied on top of the match score">${rank.boost > 0 ? '▲ +' : '▼ −'}${Math.abs(rank.boost)}</span>` : '')
    ) : '';
    const decided = status !== 'pending';
    const statusPill = {
      approved: '<span class="pill pill-green">Approved → tailoring queued</span>',
      rejected: '<span class="pill pill-red">Rejected</span>',
      later: '<span class="pill pill-amber">Saved for later</span>',
    }[status] || '';

    const chips =
      res.matched.slice(0, 4).map(r => `<span class="chip chip-yes">✓ ${esc(r)}</span>`).join('') +
      res.missing.slice(0, 2).map(m => `<span class="chip chip-no">△ ${esc(m)}</span>`).join('') +
      (res.region && !res.region.gcc && res.region.includeReason
        ? `<span class="chip chip-region" title="Why this non-GCC role is included">🌍 ${esc(res.region.includeReason)}</span>` : '') +
      (job.visaSponsorship ? '<span class="chip chip-visa">🛂 Visa sponsorship</span>' : '') +
      ((job.duplicates || []).length ? `<span class="chip chip-dup">≈ Also on ${esc(job.duplicates.join(', '))}</span>` : '');

    const actions = decided
      ? `<button class="btn btn-ghost" onclick="Jobs.undo('${job.id}')">Undo</button>`
      : `<button class="btn btn-green" onclick="Jobs.approve('${job.id}')">Approve</button>
         <button class="btn btn-amber" onclick="Jobs.later('${job.id}')">Later</button>
         <button class="btn btn-red" onclick="Jobs.reject('${job.id}')">Reject</button>`;

    const salaryPill = res.filtered
      ? (res.filterReason === 'region'
        ? `<span class="pill pill-amber">Outside GCC — no relocation/sponsorship</span>`
        : `<span class="pill pill-red">Below salary preference</span>`)
      : '';

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
              ${recBadge}${rankBadges}
              <span class="jposted">${postedRel(job.postedDate)}</span>
              ${statusPill}${salaryPill}
            </div>
            <div class="job-meta">${esc(job.location)}${job.location.toLowerCase().includes(job.workMode.toLowerCase()) ? '' : ' · ' + esc(job.workMode)} · ${esc(job.employmentType)} · ${salaryDisplay(job)}</div>
            ${scoreBreakdown(res)}
            ${matchReasons(res)}
            <div class="job-desc">${esc(job.description)}</div>
            <div class="job-chips">${chips}</div>
            ${resumeRec(job)}
            ${coverLetter(job, _ui)}
            <div class="job-foot">
              <button class="why-btn" id="whyb-${job.id}" onclick="Jobs.toggleWhy('${job.id}')">Why ranked here?</button>
              <a class="apply-link" href="${esc(job.applyUrl)}" target="_blank" rel="noopener">View posting ↗</a>
            </div>
            ${whyPanel(item)}
          </div>
          <div class="job-actions">${actions}</div>
        </div>
      </div>`;
  }

  /* Sprint 19: search / filter / sort / saved-search controls */
  function toolbar(ui) {
    if (typeof JobFilters === 'undefined') return '';
    const f = JobFilters.normalize(ui.filters);
    const sortId = ui.sort || 'match';
    const active = JobFilters.activeCount(f) + (sortId !== 'match' ? 1 : 0);
    const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
    const saved = (typeof SavedSearches !== 'undefined') ? SavedSearches.all() : [];

    return `
      <div class="card card-pad jb-tools">
        <div class="jb-row">
          <input type="text" id="job-search" class="jb-search" placeholder="Search title, company, location or skill…"
                 value="${esc(f.search)}" oninput="Jobs.setSearch(this.value)">
          <select class="jb-sel" onchange="Jobs.setSort(this.value)">
            ${JobFilters.SORTS.map(s => opt(s.id, s.label, sortId)).join('')}
          </select>
          <button class="btn btn-ghost" onclick="Jobs.clearFilters()" ${active ? '' : 'disabled'}>Clear filters${active ? ' (' + active + ')' : ''}</button>
        </div>

        <div class="jb-row">
          <label class="jb-check"><input type="checkbox" ${f.remote ? 'checked' : ''} onchange="Jobs.toggleFilter('remote')"> Remote</label>
          <label class="jb-check"><input type="checkbox" ${f.hybrid ? 'checked' : ''} onchange="Jobs.toggleFilter('hybrid')"> Hybrid</label>
          <label class="jb-check"><input type="checkbox" ${f.onsite ? 'checked' : ''} onchange="Jobs.toggleFilter('onsite')"> Onsite</label>
          <select class="jb-sel" onchange="Jobs.setFilter('employmentType', this.value)">
            ${opt('', 'Any type', f.employmentType)}${JobFilters.EMPLOYMENT_TYPES.map(t => opt(t, t, f.employmentType)).join('')}
          </select>
          <select class="jb-sel" onchange="Jobs.setFilter('experienceLevel', this.value)">
            ${opt('', 'Any experience', f.experienceLevel)}${JobFilters.EXPERIENCE_LEVELS.map(l => opt(l.id, l.label, f.experienceLevel)).join('')}
          </select>
          <select class="jb-sel" onchange="Jobs.setFilter('resumeCategory', this.value)">
            ${opt('', 'Any résumé category', f.resumeCategory)}${JobFilters.RESUME_CATEGORIES.map(c => opt(c.id, c.label, f.resumeCategory)).join('')}
          </select>
          <input type="number" class="jb-num" placeholder="Min $k" value="${esc(f.salaryMin)}" onchange="Jobs.setFilter('salaryMin', this.value)">
          <input type="number" class="jb-num" placeholder="Max $k" value="${esc(f.salaryMax)}" onchange="Jobs.setFilter('salaryMax', this.value)">
        </div>

        <div class="jb-row jb-saved">
          <span class="jb-lbl">SAVED SEARCHES</span>
          ${saved.length ? saved.map(s => `
            <span class="jb-chip">
              <button class="jb-chip-load" onclick="Jobs.loadSearch('${esc(s.id)}')" title="Load this search">${esc(s.name)}</button>
              <button class="jb-chip-x" onclick="Jobs.renameSearch('${esc(s.id)}')" title="Rename">✎</button>
              <button class="jb-chip-x" onclick="Jobs.deleteSearch('${esc(s.id)}')" title="Delete">✕</button>
            </span>`).join('')
        : '<span class="hint" style="margin:0">None yet — set a search/filters, name it, then Save.</span>'}
          <input type="text" id="job-save-name" class="jb-name" placeholder="Name this search…">
          <button class="btn btn-primary" onclick="Jobs.saveSearch()">Save</button>
        </div>
        <div class="hint">Undisclosed salaries are never filtered out. Search, filters and sorting only change what you see — your decisions and rules are untouched.</div>
      </div>`;
  }

  function render({ items, ui, minSalary, summaryHtml }) {
    _ui = ui || {};
    /* priority ranking: order by rankScore (match score + boosts) */
    const byRank = (a, b) =>
      ((b.rank ? b.rank.rankScore : b.res.score) - (a.rank ? a.rank.rankScore : a.res.score));
    const visible = items.filter(x => !x.res.filtered).slice().sort(byRank);
    const hidden = items.filter(x => x.res.filtered).slice().sort(byRank);

    /* Sprint 19: search + filters narrow the board, then sorting orders it */
    const matched = (typeof JobFilters !== 'undefined') ? JobFilters.apply(visible, ui.filters) : visible;
    const bySource = s => (s === 'All' ? matched : matched.filter(x => x.job.source === s));
    const picked = bySource(ui.source);
    const shown = (typeof JobFilters !== 'undefined') ? JobFilters.sort(picked, ui.sort) : picked;
    const narrowed = matched.length !== visible.length;

    const approved = items.filter(x => x.status === 'approved').length;
    const rejected = items.filter(x => x.status === 'rejected').length;
    const pending = visible.filter(x => x.status === 'pending').length;

    const filters = ['All', ...JobsStore.SOURCES].map(s => `
      <button class="filter-chip ${ui.source === s ? 'active' : ''}" onclick="Jobs.setSource('${s}')">
        ${s} · ${s === 'All' ? matched.length : bySource(s).length}
      </button>`).join('');

    const hiddenSalary = hidden.filter(x => x.res.filterReason === 'salary').length;
    const hiddenRegion = hidden.filter(x => x.res.filterReason === 'region').length;
    const hiddenWhy = [
      hiddenSalary ? `${hiddenSalary} below your $${minSalary}k minimum` : '',
      hiddenRegion ? `${hiddenRegion} outside the GCC without relocation support or visa sponsorship` : '',
    ].filter(Boolean).join(' · ');
    const hiddenBlock = hidden.length ? `
      <div class="card hidden-note">
        <div class="hn-row">
          <span class="hn-txt"><b>${hidden.length} job${hidden.length > 1 ? 's' : ''} hidden by your rules</b> — ${hiddenWhy}. Undisclosed or “negotiable” salaries are never filtered.</span>
          <button class="btn btn-ghost" onclick="Jobs.toggleHidden()">${ui.showHidden ? 'Hide' : 'Show anyway'}</button>
        </div>
      </div>
      ${ui.showHidden ? `<div style="display:flex; flex-direction:column; gap:11px; margin-top:11px">${hidden.map(x => jobCard(x, true)).join('')}</div>` : ''}`
      : '';

    return `
      <p class="screen-intro">Sourced from LinkedIn, Bayt, GulfTalent and company career pages, normalized into one job model and scored 0–100 by the match engine against your full profile. Live crawling connects in the backend sprint. Your master resume is read <b>only</b> — approving queues a tailored <i>copy</i> for your sign-off.</p>
      ${summaryHtml || ''}
      <div class="jobs-summary">
        <span class="t">Today's jobs · ${items.length} sourced from ${JobsStore.SOURCES.length} boards${narrowed ? ` · <b>${matched.length} match your search</b>` : ''}</span>
        <div class="counts">
          <span style="color:var(--green)">✓ ${approved} approved</span>
          <span style="color:var(--red)">✕ ${rejected} rejected</span>
          <span style="color:var(--amber)">◷ ${pending} pending</span>
        </div>
      </div>
      ${toolbar(ui)}
      <div class="filters">${filters}</div>
      <div style="display:flex; flex-direction:column; gap:11px">
        ${shown.map(x => jobCard(x, false)).join('')
          || (narrowed
            ? '<div class="empty"><b>No jobs match your search or filters</b>Clear them to see the full board again.</div>'
            : '<div class="empty"><b>No jobs from this source today</b>Try another board filter.</div>')}
      </div>
      <div style="margin-top:14px">${hiddenBlock}</div>`;
  }

  return { render, scoreClass, salaryDisplay, postedRel };
})();
