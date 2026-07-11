/* ============================================================
   PrepView — rendering for application packages (Sprint 10C).

   Two surfaces, both additive (no existing screen redesigned):
   • approvalsCard() — the "Prepared application packages" card
     shown at the top of the existing Approvals screen
   • reviewScreen(pkg) — the final review screen (#/review):
     resume version, cover letter, answers, safety score,
     missing information, and the exact source job details.
     There is deliberately NO submit control anywhere.
   ============================================================ */

const PrepView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const CHIP_CLASS = {
    approved: 'prep-neutral',
    preparing_resume: 'prep-neutral',
    preparing_cover_letter: 'prep-neutral',
    preparing_answers: 'prep-neutral',
    ready_for_review: 'prep-indigo',
    ready_to_apply: 'prep-green',
    blocked_manual_review: 'prep-red',
  };

  function statusChip(status) {
    return `<span class="prep-chip ${CHIP_CLASS[status] || 'prep-neutral'}">${esc(PrepStore.statusLabel(status))}</span>`;
  }

  function salaryLine(job) {
    if (!job.salaryDisclosed) return typeof job.salary === 'string' ? job.salary : 'Not disclosed';
    const n = v => Number(v).toLocaleString('en-US');
    return job.salaryPeriod === 'month'
      ? `${job.currency} ${n(job.salary)}${job.salaryMax ? '–' + n(job.salaryMax) : ''}/month`
      : `${job.currency === 'USD' ? '$' : job.currency + ' '}${job.salary}k${job.salaryMax ? '–' + (job.currency === 'USD' ? '$' : '') + job.salaryMax + 'k' : ''}/year`;
  }

  /* ---------- Approvals screen: real packages card ---------- */

  function approvalsCard(packages) {
    const rows = packages.map(pkg => `
      <div class="prep-row">
        <div class="prep-main">
          <div class="prep-top"><b>${esc(pkg.job.title)}</b><span class="prep-co">· ${esc(pkg.job.company)}</span>${statusChip(pkg.status)}</div>
          <div class="prep-meta">${esc(pkg.job.source)} · match ${pkg.matchScore} · resume safety ${pkg.resume.safety.score} · ${pkg.answers.filter(a => a.supported).length}/${pkg.answers.length} answers drafted${pkg.blockers.length ? ` · <span class="prep-warn">⚠ ${pkg.blockers.length} item${pkg.blockers.length > 1 ? 's' : ''} need manual review</span>` : ''}</div>
        </div>
        <button class="btn btn-primary" onclick="Prep.review('${pkg.jobId}')">Review package</button>
      </div>`).join('');
    return `
      <div class="card card-pad" id="card-prep">
        <p class="card-title">Prepared application packages</p>
        <div class="hint" style="margin-bottom:9px">Built automatically when you approve a job — tailored copy of the locked master, cover letter, answers and safety report. Nothing is ever submitted from here.</div>
        ${rows || '<div class="hint">No packages yet — approve a job in Today\'s Jobs and its package appears here.</div>'}
      </div>`;
  }

  /* ---------- the final review screen ---------- */

  function answerRow(a) {
    return `
      <div class="ans-row ${a.supported ? '' : 'ans-flagged'}">
        <div class="ans-q">${esc(a.question)}${a.supported ? '' : ' <span class="pill pill-amber">Manual review required</span>'}</div>
        ${a.supported
          ? `<div class="ans-a">${esc(a.answer)}</div><div class="ans-src">Source: ${esc(a.source)}</div>`
          : `<div class="ans-a ans-empty">— needs your input —</div><div class="ans-src">${esc(a.note)}</div>`}
      </div>`;
  }

  function reviewScreen(pkg, profile) {
    if (!pkg) {
      return `
        <div class="card card-pad">
          <p class="card-title">No package selected</p>
          <div class="hint" style="margin-bottom:12px">Approve a job in Today's Jobs, then open its package from the Approvals screen.</div>
          <button class="btn btn-primary" onclick="location.hash='#/approvals'">Go to Approvals</button>
        </div>`;
    }
    const job = pkg.job;
    const r = pkg.resume;
    const stat = (n, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
    const missing = [
      ...pkg.missingInfo.map(m => `<div class="mi-row">⚠ <b>${esc(m.item)}</b> — ${esc(m.note)}</div>`),
      ...pkg.flaggedAnswers.map(q => `<div class="mi-row">⚠ <b>Answer needs you:</b> ${esc(q)}</div>`),
    ].join('');

    return `
      <p class="screen-intro">The complete application package — review every document before anything moves. Submission does not exist in this build; “Ready to Apply” is a status you set, not a send button.</p>

      <div class="card card-pad">
        <div class="prep-top" style="flex-wrap:wrap">
          <b style="font-size:16px">${esc(job.title)}</b><span class="prep-co" style="font-size:15px">· ${esc(job.company)}</span>
          ${statusChip(pkg.status)}
          <span class="prep-chip prep-neutral">Match ${pkg.matchScore}</span>
          <span class="prep-chip ${r.safety.score === 100 ? 'prep-green' : 'prep-red'}">Safety ${r.safety.score}</span>
        </div>
        <div class="prep-meta" style="margin-top:6px">
          ${esc(job.location)} · ${esc(job.workMode)} · ${esc(job.employmentType)} · ${esc(salaryLine(job))} · via ${esc(job.source)}
          · <a href="${esc(pkg.sourceUrl)}" target="_blank" rel="noopener">Open original posting ↗</a>
        </div>
        <div class="prep-actions">
          <button class="btn btn-green" onclick="Prep.markReady('${pkg.jobId}')" ${pkg.status === 'ready_for_review' ? '' : 'disabled'}>Mark Ready to Apply</button>
          <button class="btn btn-ghost" onclick="location.hash='#/approvals'">← Back to Approvals</button>
          <span class="hint" style="margin:0">${pkg.status === 'blocked_manual_review' ? 'Blocked — resolve the manual-review items below first.' : pkg.status === 'ready_to_apply' ? 'Ready — submission stays manual by design.' : 'Your explicit action is required; nothing is ever sent automatically.'}</span>
        </div>
      </div>

      <div class="card card-pad">
        <p class="card-title">Preparation & safety</p>
        <div class="ds-stats">
          ${stat(r.safety.score, 'resume safety', r.safety.score === 100 ? 'good' : 'bad')}
          ${stat(r.safety.verified, 'items verified vs master', 'good')}
          ${stat(r.safety.unsupported.length, 'facts invented', r.safety.unsupported.length ? 'bad' : 'good')}
          ${stat(esc(r.interviewConfidence), 'interview confidence')}
          ${stat(pkg.matchScore, 'match score')}
          ${stat(pkg.answers.filter(a => a.supported).length + '/' + pkg.answers.length, 'answers drafted')}
        </div>
        ${pkg.decision ? `
          <div class="prep-sub">DECISION EXPLANATION · ${esc(pkg.decision.recommendation)} · ${esc(pkg.decision.confidence)} confidence</div>
          ${pkg.decision.reasons.map(x => `<div class="why-row">${x.ok ? '✓' : '✗'} ${esc(x.text)}</div>`).join('')}` : ''}
        ${pkg.blockers.length ? `
          <div class="prep-sub" style="color:var(--red)">BLOCKED FOR MANUAL REVIEW</div>
          ${pkg.blockers.map(b => `<div class="why-row">✗ ${esc(b)}</div>`).join('')}` : ''}
      </div>

      ${missing ? `
        <div class="card card-pad">
          <p class="card-title">Missing information</p>
          ${missing}
        </div>` : ''}

      <div class="card card-pad">
        <p class="card-title">Application answers</p>
        <div class="hint" style="margin-bottom:8px">Drafted only from your Profile and this posting — anything unproven is flagged, never guessed.</div>
        ${pkg.answers.map(answerRow).join('')}
      </div>

      <div class="rev-grid">
        <div class="card card-pad">
          <p class="card-title">Tailored resume — ${esc(r.label)}</p>
          <div class="hint" style="margin-bottom:9px">${esc(r.base)} · ${r.plan.changes.length} change${r.plan.changes.length === 1 ? '' : 's'}, all reorder/emphasis — <b>0 facts invented</b>.</div>
          ${ResumesView.resumePaper(profile, { company: job.company, title: job.title }, r.matched, r.plan)}
        </div>
        <div class="card card-pad">
          <p class="card-title">Cover letter</p>
          <pre class="prep-letter">${esc(pkg.coverLetter)}</pre>
          <p class="card-title" style="margin-top:16px">Source job details</p>
          <div class="prep-meta" style="margin-bottom:7px">${esc(job.source)} · posting ${esc(job.sourceJobId)} · posted ${esc(job.postedDate)}</div>
          <div class="ans-a" style="margin-bottom:8px">${esc(job.description)}</div>
          <div class="job-chips">${(job.skills || []).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
          ${(pkg.sources || []).length > 1 ? `
            <div class="prep-sub">ALSO SEEN ON</div>
            ${pkg.sources.map(s => `<div class="ans-src">${esc(s.source)} · <a href="${esc(s.applyUrl)}" target="_blank" rel="noopener">${esc(s.sourceJobId)}</a></div>`).join('')}` : ''}
        </div>
      </div>`;
  }

  return { approvalsCard, reviewScreen, statusChip };
})();
