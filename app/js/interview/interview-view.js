/* ============================================================
   InterviewView — rendering for the Interview Copilot (Sprint 13
   PART 8). Rebuilds the existing Interview Prep page around real
   submitted applications, keeping the CareerPilot design language
   (cards, pills, tabs, iv-* picker). Six sections:

     Overview · Submitted resume · Questions · STAR library ·
     Mock interview · Follow-up

   Everything renders from the frozen application memory + engines;
   this file has no state of its own (the controller owns UI state).
   ============================================================ */

const InterviewView = (() => {

  const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const TABS = [
    ['overview', 'Overview'], ['resume', 'Submitted resume'], ['questions', 'Questions'],
    ['star', 'STAR library'], ['mock', 'Mock interview'], ['followup', 'Follow-up'],
  ];

  function safetyPill(s) {
    const map = { safe: ['ic-safe', 'Safe to discuss'], prep: ['ic-prep', 'Needs preparation'], blocked: ['ic-blocked', 'Unsupported · blocked'] };
    const [cls, label] = map[s] || map.prep;
    return `<span class="ic-pill ${cls}">${label}</span>`;
  }
  function statusChip(status) {
    const cls = status === 'offer' ? 'prep-green' : status === 'rejected' ? 'prep-red'
      : status === 'submitted' ? 'prep-neutral' : 'prep-indigo';
    return `<span class="prep-chip ${cls}">${esc(ApplicationMemory.statusLabel(status))}</span>`;
  }
  function fmtDate(t) { return t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
  function salaryLine(job) {
    if (!job.salaryDisclosed) return (typeof job.salary === 'string' && job.salary) ? job.salary : 'Not disclosed';
    const n = v => Number(v).toLocaleString('en-US');
    return job.salaryPeriod === 'month'
      ? `${job.currency} ${n(job.salary)}${job.salaryMax ? '–' + n(job.salaryMax) : ''}/month`
      : `${job.currency === 'USD' ? '$' : job.currency + ' '}${job.salary}k${job.salaryMax ? '–' + job.salaryMax + 'k' : ''}/year`;
  }

  /* ---------- top-level screen ---------- */
  function screen(list, rec, profile, ui) {
    if (!list.length) {
      return `
        <p class="screen-intro">Interview Copilot prepares you using the <b>exact</b> job, resume, cover letter and answers you submitted — nothing invented.</p>
        <div class="card card-pad">
          <p class="card-title">No submitted applications yet</p>
          <div class="hint" style="margin-bottom:12px">Once you submit an application (Approvals → Review package → Approve &amp; Submit), it is remembered here and the full interview prep is generated automatically.</div>
          <button class="btn btn-primary" onclick="location.hash='#/approvals'">Go to Approvals</button>
        </div>`;
    }

    const picker = list.map(m => `
      <button class="iv-pick ${m.jobId === rec.jobId ? 'active' : ''}" onclick="Interview.select('${esc(m.jobId)}')">
        <span class="co">${esc(m.company)}</span>
        <span class="wh">${esc(ApplicationMemory.statusLabel(m.status))}</span>
      </button>`).join('');

    const tabs = TABS.map(([id, label]) =>
      `<button class="tab ${ui.tab === id ? 'active' : ''}" onclick="Interview.tab('${id}')">${label}</button>`).join('');

    let body = '';
    if (ui.tab === 'overview') body = overview(rec, profile);
    else if (ui.tab === 'resume') body = resumeSection(rec);
    else if (ui.tab === 'questions') body = questionsSection(rec, profile);
    else if (ui.tab === 'star') body = starSection(rec, profile);
    else if (ui.tab === 'mock') body = mockSection(rec, profile, ui);
    else if (ui.tab === 'followup') body = followupSection(rec);

    return `
      <p class="screen-intro">Interview Copilot — prep built from the <b>exact</b> submitted application. Every suggested answer traces to your resume, profile or submitted package, or is flagged for manual review.</p>
      <div class="iv-picker">${picker}</div>
      <div class="iv-head">
        <span class="role">${esc(rec.company)} · ${esc(rec.role)}</span>
        ${statusChip(rec.status)}
        <span class="prep-chip prep-neutral">Applied ${fmtDate(rec.dateApplied)}</span>
        ${rec.submissionId ? `<span class="prep-chip prep-neutral">${esc(rec.submissionId)}</span>` : ''}
      </div>
      <div class="ic-tabs">${tabs}</div>
      ${body}`;
  }

  /* ---------- Overview ---------- */
  function overview(rec, profile) {
    const pk = InterviewEngine.prepPackage(rec, profile);
    const roll = InterviewEngine.safetyRollup(rec, profile);
    const js = pk.jobSummary;
    const stat = (n, l, cls) => `<div class="ds-stat ${cls || ''}"><b>${n}</b><span>${l}</span></div>`;

    const skillChips = arr => arr.length ? arr.map(s => `<span class="chip">${esc(s)}</span>`).join('') : '<span class="hint">—</span>';
    return `
      <div class="grid grid-2">
        <div class="card card-pad">
          <p class="card-title">Job summary</p>
          <div class="prep-meta" style="margin-bottom:8px">${esc(js.location)} · ${esc(js.workMode)} · ${esc(js.employmentType)} · via ${esc(js.source)}
            ${js.url ? `· <a href="${esc(js.url)}" target="_blank" rel="noopener">original posting ↗</a>` : ''}</div>
          <div class="ans-a">${esc(js.description) || '<span class="hint">No description on record.</span>'}</div>
          <p class="card-title" style="margin-top:14px">Company summary <span class="hint" style="font-weight:400">· placeholder</span></p>
          <div class="prep-meta">${esc(pk.companySummary.name)} · <b>${esc(pk.companySummary.tierLabel)}</b></div>
          <div class="hint" style="margin-top:4px">${esc(pk.companySummary.note)}</div>
        </div>
        <div class="card card-pad">
          <p class="card-title">Interview readiness</p>
          <div class="ds-stats">
            ${stat(rec.matchScore != null ? rec.matchScore : '—', 'match score')}
            ${stat(rec.resumeSafety != null ? rec.resumeSafety : '—', 'resume safety', rec.resumeSafety === 100 ? 'good' : '')}
            ${stat(roll.safe, 'answers safe', 'good')}
            ${stat(roll.prep, 'need prep')}
            ${stat(roll.blocked, 'blocked', roll.blocked ? 'bad' : 'good')}
          </div>
          <div class="prep-sub">REQUIRED SKILLS</div>
          <div class="job-chips">${skillChips(pk.requiredSkills)}</div>
          <div class="prep-sub">MATCHED (from your master resume)</div>
          <div class="job-chips">${pk.matchedSkills.length ? pk.matchedSkills.map(s => `<span class="chip chip-yes">✓ ${esc(s)}</span>`).join('') : '<span class="hint">—</span>'}</div>
          <div class="prep-sub">MISSING / WEAKER</div>
          <div class="job-chips">${pk.missingSkills.length ? pk.missingSkills.map(s => `<span class="chip chip-amber">${esc(s)}</span>`).join('') : '<span class="hint">none — strong coverage</span>'}</div>
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card card-pad">
          <p class="card-title">Key achievements to discuss</p>
          ${pk.achievements.length ? pk.achievements.map(a => `
            <div class="ic-eyebrow">${safetyPill(a.safety)}</div>
            <div class="ans-a">${esc(a.text)}</div>
            <div class="ans-src">Source: ${esc(a.source)}</div>`).join('<div class="ic-div"></div>')
            : '<div class="hint">No metric-bearing achievements found on the submitted resume.</div>'}
        </div>
        <div class="card card-pad">
          <p class="card-title">Risks &amp; areas needing preparation</p>
          ${pk.risks.length ? pk.risks.map(r => `
            <div class="mi-row">${safetyPill(r.safety)} <b>${esc(r.item)}</b> — ${esc(r.note)}</div>`).join('')
            : '<div class="hint">No open risks flagged.</div>'}
        </div>
      </div>`;
  }

  /* ---------- Submitted resume (exact) ---------- */
  function resumeSection(rec) {
    const doc = rec.submitted.resumeDoc;
    const meta = rec.submitted.resumeMeta;
    const roles = (doc.roles || []).map(r => `
      <div class="ic-role">
        <div class="ic-role-h"><b>${esc(r.title)}</b> · ${esc(r.company)} <span class="ans-src">${esc(r.period)}</span></div>
        <ul class="iv-list">${(r.bullets || []).map(b => `<li>${esc(b)}</li>`).join('')}</ul>
      </div>`).join('');
    return `
      <div class="card card-pad">
        <p class="card-title">Submitted resume version <span class="hint" style="font-weight:400">· exact copy, frozen at submission</span></p>
        <div class="prep-meta" style="margin-bottom:10px"><b>${esc(meta.label)}</b> · safety ${meta.safety} · ${meta.changes} tailoring change${meta.changes === 1 ? '' : 's'} · ${esc(meta.base)}</div>
        ${doc.degraded ? '<div class="hint">Full resume plan was unavailable at capture; showing recorded metadata.</div>' : `
          ${doc.summary ? `<div class="prep-sub">SUMMARY</div><p class="ans-a">${esc(doc.summary)}</p>` : ''}
          <div class="prep-sub">SKILLS</div><div class="job-chips">${(doc.skills || []).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
          ${(doc.certifications || []).length ? `<div class="prep-sub">CERTIFICATIONS</div>${doc.certifications.map(c => `<div class="ans-a">${esc(c)}</div>`).join('')}` : ''}
          <div class="prep-sub">EXPERIENCE</div>${roles}`}
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card card-pad">
          <p class="card-title">Submitted cover letter</p>
          <pre class="prep-letter">${esc(rec.submitted.coverLetter) || '<span class="hint">None submitted.</span>'}</pre>
        </div>
        <div class="card card-pad">
          <p class="card-title">Submitted application answers</p>
          ${(rec.submitted.answers || []).map(a => `
            <div class="ans-row ${a.supported ? '' : 'ans-flagged'}">
              <div class="ans-q">${esc(a.question)} ${a.supported ? safetyPill('safe') : safetyPill('blocked')}</div>
              ${a.supported ? `<div class="ans-a">${esc(a.answer)}</div><div class="ans-src">Source: ${esc(a.source)}</div>`
                : `<div class="ans-a ans-empty">— left for manual completion —</div>`}
            </div>`).join('')}
        </div>
      </div>`;
  }

  /* ---------- Questions ---------- */
  function qRow(q) {
    return `
      <div class="ic-q">
        <div class="ic-q-top">${safetyPill(q.safety)} <b>${esc(q.q)}</b></div>
        ${q.a ? `<div class="ans-a">${esc(q.a)}</div>${q.source ? `<div class="ans-src">Source: ${esc(q.source)}</div>` : ''}`
          : `<div class="ans-a ans-empty">— ${esc(q.flag || 'Manual review required')} —</div>${q.note ? `<div class="ans-src">${esc(q.note)}</div>` : ''}`}
      </div>`;
  }
  function questionsSection(rec, profile) {
    const groups = InterviewEngine.questionGroups(rec, profile);
    return groups.map(g => `
      <div class="card card-pad">
        <p class="card-title">${esc(g.label)} <span class="hint" style="font-weight:400">· ${g.questions.length} question${g.questions.length === 1 ? '' : 's'}</span></p>
        ${g.questions.length ? g.questions.map(qRow).join('') : '<div class="hint">No questions generated for this group.</div>'}
      </div>`).join('');
  }

  /* ---------- STAR library ---------- */
  function starSection(rec, profile) {
    const stars = StarLibrary.build(profile, rec);
    const sum = StarLibrary.summary(stars);
    const cards = stars.map(s => `
      <div class="card card-pad ic-star ${s.safety}">
        <div class="ic-q-top">${safetyPill(s.safety)} <b>${esc(s.theme)}</b> <span class="prep-chip prep-neutral">${esc(s.confidence)}</span></div>
        ${s.safety === 'blocked'
          ? `<div class="ans-a ans-empty">— ${esc(s.flag)} —</div><div class="ans-src">${esc(s.note)}</div>`
          : `<div class="ic-star-grid">
               <div><span class="ic-k">S</span> ${esc(s.situation)}</div>
               <div><span class="ic-k">T</span> ${esc(s.task)}</div>
               <div><span class="ic-k">A</span> ${esc(s.action)}</div>
               <div><span class="ic-k">R</span> ${esc(s.result)}</div>
             </div>
             <div class="ans-src">Source: ${esc(s.source)}${s.flag ? ` · ⚠ ${esc(s.flag)}` : ''}</div>`}
      </div>`).join('');
    return `
      <div class="card card-pad">
        <p class="card-title">STAR answer library</p>
        <div class="hint">Reusable examples built only from your real experience. ${sum.safe} safe · ${sum.prep} need prep · ${sum.blocked} unsupported (add a real example to unlock).</div>
      </div>
      ${cards}`;
  }

  /* ---------- Mock interview ---------- */
  function mockSection(rec, profile, ui) {
    const mode = ui.mode || 'technical';
    const session = MockInterview.ensure(rec, profile, mode);
    const prog = MockInterview.progress(session);
    const i = session.index;
    const q = session.questions[i];
    const modeBtns = MockInterview.MODES.map(m =>
      `<button class="tab ${m.id === mode ? 'active' : ''}" onclick="Interview.setMode('${m.id}')">${m.label}</button>`).join('');

    if (!q) {
      return `<div class="card card-pad"><p class="card-title">Mock interview</p><div class="ic-tabs">${modeBtns}</div><div class="hint" style="margin-top:10px">No questions available for this mode on this application.</div></div>`;
    }
    const rating = session.ratings[i] || 0;
    const ratingBtns = [1, 2, 3, 4, 5].map(n =>
      `<button class="ic-rate ${n <= rating ? 'on' : ''}" onclick="Interview.mockRate('${esc(rec.jobId)}',${i},${n})">${n}</button>`).join('');

    return `
      <div class="card card-pad">
        <div class="ic-q-top" style="justify-content:space-between">
          <p class="card-title" style="margin:0">Mock interview</p>
          <span class="hint">Question ${i + 1} / ${session.questions.length} · ${prog.answered} answered</span>
        </div>
        <div class="ic-tabs" style="margin-top:8px">${modeBtns}</div>
        <div class="ic-mock">
          <div class="ic-q-top" style="margin-top:6px">${safetyPill(q.safety)} <span class="prep-chip prep-neutral">${esc(q.category)}</span></div>
          <div class="ic-mock-q">${esc(q.q)}</div>

          <label class="ic-label">Your answer</label>
          <textarea class="ic-ta" rows="4" placeholder="Practise your answer…" onchange="Interview.mockAnswer('${esc(rec.jobId)}',${i},this.value)">${esc(session.answers[i] || '')}</textarea>

          <label class="ic-label">Suggested answer ${q.a ? '' : '<span class="hint">(none — flagged for manual prep)</span>'}</label>
          ${q.a ? `<div class="ic-suggest">${esc(q.a)}</div>${q.source ? `<div class="ans-src">Source: ${esc(q.source)}</div>` : ''}`
            : `<div class="ic-suggest ans-empty">${esc(q.flag || 'Manual review required')} — build this from your real experience.</div>`}

          <label class="ic-label">Key points expected</label>
          <ul class="iv-list">${(q.keyPoints || []).map(k => `<li>${esc(k)}</li>`).join('') || '<li class="hint">—</li>'}</ul>

          <div class="ic-mock-foot">
            <div><label class="ic-label" style="margin:0 8px 0 0">Confidence</label>${ratingBtns}</div>
          </div>
          <label class="ic-label">Improvement notes</label>
          <textarea class="ic-ta" rows="2" placeholder="What to tighten next time…" onchange="Interview.mockNote('${esc(rec.jobId)}',${i},this.value)">${esc(session.notes[i] || '')}</textarea>

          <div class="prep-actions">
            <button class="btn btn-ghost" onclick="Interview.mockPrev('${esc(rec.jobId)}')" ${i === 0 ? 'disabled' : ''}>← Previous</button>
            <button class="btn btn-primary" onclick="Interview.mockNext('${esc(rec.jobId)}')" ${i >= session.questions.length - 1 ? 'disabled' : ''}>Next question →</button>
            <button class="btn btn-ghost" onclick="Interview.mockRestart('${esc(rec.jobId)}')">Restart session</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------- Follow-up tracker ---------- */
  function followupSection(rec) {
    const it = rec.interview || {};
    const stateBtns = ApplicationMemory.STATES.map(s =>
      `<button class="tab ${rec.status === s.id ? 'active' : ''}" onclick="Interview.setStatus('${esc(rec.jobId)}','${s.id}')">${esc(s.label)}</button>`).join('');
    const typeOpts = ['', ...ApplicationMemory.INTERVIEW_TYPES].map(t =>
      `<option value="${esc(t)}" ${t === it.type ? 'selected' : ''}>${t || '— select —'}</option>`).join('');
    const events = (rec.events || []).slice().reverse().map(e =>
      `<div class="tl-row"><span class="tl-dot info"></span><div class="tl-body"><p>${esc(ApplicationMemory.statusLabel(e.status))}</p><span class="tl-time">${fmtDate(e.at)}</span></div></div>`).join('');

    return `
      <div class="card card-pad">
        <p class="card-title">Interview workflow</p>
        <div class="ic-tabs" style="flex-wrap:wrap">${stateBtns}</div>
      </div>
      <div class="grid grid-2" style="margin-top:12px">
        <div class="card card-pad">
          <p class="card-title">Interview details</p>
          <div class="cfg-policy">
            <div class="field"><label>Interview date</label><input type="date" id="iv-idate" value="${esc(it.date)}"></div>
            <div class="field"><label>Interview type</label><select id="iv-itype">${typeOpts}</select></div>
            <div class="field"><label>Follow-up date</label><input type="date" id="iv-followup" value="${esc(rec.followUpDate)}"></div>
          </div>
          <div class="field"><label>Interviewer</label><input type="text" id="iv-interviewer" value="${esc(it.interviewer)}" placeholder="Name / role"></div>
          <div class="field"><label>Meeting link</label><input type="text" id="iv-link" value="${esc(it.meetingLink)}" placeholder="https://…"></div>
          <div class="field"><label>Recruiter notes</label><textarea id="iv-recruiter" rows="2" placeholder="Recruiter conversation notes…">${esc(rec.recruiterNotes)}</textarea></div>
          <div class="field"><label>Interview notes</label><textarea id="iv-notes" rows="3" placeholder="Notes after the interview…">${esc(rec.notes)}</textarea></div>
          <button class="btn btn-primary" onclick="Interview.saveTracker('${esc(rec.jobId)}')">Save details</button>
        </div>
        <div class="card card-pad">
          <p class="card-title">History</p>
          <div class="tline">${events || '<div class="hint">No status changes yet.</div>'}</div>
        </div>
      </div>`;
  }

  return { screen, safetyPill };
})();
