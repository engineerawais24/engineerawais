/* ============================================================
   JobFetchView — the "Fetch Jobs Now" panel (Job Discovery v1).

   ADDITIVE, like the search panel: one card at the top of Today's Jobs,
   built from the CSS the app already has. Nothing existing is redesigned,
   moved or removed.

   It shows exactly what the spec asks for and nothing more:
     • one saved search URL per portal (LinkedIn / Bayt / GulfTalent)
     • one button — Fetch Jobs Now
     • four plain counts — found · saved · duplicate · failed
     • per source: OK, or NEEDS ATTENTION when the portal wants a sign-in
       or shows a CAPTCHA

   No match scores, no ranking, no autofill controls: those are other
   features and stay where they are.
   ============================================================ */

const JobFetchView = (() => {

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function ago(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  }

  /* the four counts, and only the four counts */
  function countChips(run) {
    if (!run || !run.ok) return '';
    const t = run.totals || {};
    return [
      ['found', t.found, 'prep-neutral'],
      ['saved', t.saved, t.saved ? 'prep-green' : 'prep-neutral'],
      ['duplicate', t.duplicate, 'prep-neutral'],
      ['failed', t.failed, t.failed ? 'prep-red' : 'prep-neutral'],
    ].map(([k, v, cls]) => `<span class="prep-chip ${cls}">${esc(k)} ${Number(v || 0)}</span>`).join(' ');
  }

  function searchRow(src, ui) {
    const draft = (ui && ui.drafts && ui.drafts[src.id] !== undefined) ? ui.drafts[src.id] : src.url;
    return `
      <div class="ldrow">
        <div style="flex:1">
          <b>${esc(src.label)}</b>
          <input type="text" id="jf-url-${esc(src.id)}" value="${esc(draft)}"
                 placeholder="${esc(src.example)}"
                 oninput="JobFetch.setDraft('${esc(src.id)}', this.value)"
                 style="width:100%; padding:8px 10px; border:1px solid var(--border); border-radius:8px;
                        background:var(--card); font-family:inherit; font-size:12.5px; color:var(--ink); margin-top:4px">
        </div>
        <button class="btn btn-ghost" onclick="JobFetch.saveSearch('${esc(src.id)}')">Save</button>
      </div>`;
  }

  const STATUS_CHIP = {
    'ok': ['prep-green', 'ok'],
    'needs-attention': ['prep-red', 'needs attention'],
    'failed': ['prep-red', 'failed'],
    'skipped': ['prep-neutral', 'not run'],
  };

  /* how the read went — shown small and muted under the counts, so the four
     counts stay the headline while a bad harvest is still diagnosable */
  function diagLine(d) {
    if (!d) return '';
    return `${d.scrollRounds} scroll round${d.scrollRounds === 1 ? '' : 's'} · `
      + `${d.cardCandidates} card candidate${d.cardCandidates === 1 ? '' : 's'} · `
      + `${d.uniqueIds} unique id${d.uniqueIds === 1 ? '' : 's'} · `
      + `${d.parsed} parsed · ${d.failedCards} failed`;
  }

  function sourceRow(row) {
    const [cls, label] = STATUS_CHIP[row.status] || ['prep-neutral', esc(row.status)];
    const counts = `found ${Number(row.found || 0)} · saved ${Number(row.saved || 0)} · duplicate ${Number(row.duplicate || 0)} · failed ${Number(row.failed || 0)}`;
    const diag = diagLine(row.diag);
    return `
      <div class="ldrow">
        <div style="flex:1">
          <b>${esc(row.id)}</b>
          <span>${esc(counts)}</span>
          ${diag ? `<span>${esc(diag)}</span>` : ''}
          ${row.reason ? `<span style="color:var(--red)">${esc(row.reason)}</span>` : ''}
        </div>
        <span class="prep-chip ${cls}">${esc(label)}</span>
      </div>`;
  }

  function panel(uiState) {
    if (typeof JobFetchStore === 'undefined') return '';
    const ui = uiState || {};
    const sources = JobFetchStore.sources();
    const run = JobFetchStore.lastRun();
    const anyConfigured = sources.some(s => s.configured);

    return `
      <div class="card card-pad se-card">
        <div class="se-head">
          <p class="card-title" style="margin:0">Job discovery
            <span class="hint" style="font-weight:400">· LinkedIn · Bayt · GulfTalent · runs in the Chrome you are already signed into</span></p>
          <div class="job-chips">${countChips(run)}</div>
          <button class="btn btn-primary" onclick="JobFetch.fetchNow()" ${ui.running ? 'disabled' : ''}>
            ${ui.running ? 'Fetching…' : 'Fetch Jobs Now'}</button>
        </div>

        <div class="prep-sub">SAVED SEARCH — ONE PER PORTAL</div>
        ${sources.map(s => searchRow(s, ui)).join('')}
        ${!anyConfigured ? '<div class="hint" style="margin-top:8px">Paste a search URL from each portal — the same address you see in Chrome after running that search.</div>' : ''}
        ${ui.error ? `<div class="mi-row" style="margin-top:8px">⛔ ${esc(ui.error)}</div>` : ''}

        ${run ? `
          <div class="prep-sub">LAST FETCH${run.at ? ' · ' + esc(ago(run.at)) : ''}</div>
          ${run.ok
            ? (run.sources || []).map(sourceRow).join('') || '<div class="hint">No sources ran.</div>'
            : `<div class="mi-row">⛔ ${esc(run.error || 'The fetch did not run')}</div>`}` : ''}

        <div class="hint" style="margin-top:10px">Fetched jobs are saved through CareerPilot's backend and appear in Today's Jobs below.
          Nothing is applied to and nothing is submitted.</div>
      </div>`;
  }

  return { panel, countChips, sourceRow, searchRow, diagLine };
})();
