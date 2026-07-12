/* ============================================================
   StarLibrary — reusable STAR examples from REAL experience
   (Sprint 13 PART 4 & 5).

   Ten interview themes. Each is populated ONLY from evidence the
   user actually has — master-resume bullets, employment history,
   the profile summary, and the exact submitted application
   answers. Nothing is invented: a theme with no supporting
   evidence ships EMPTY with confidence "Unsupported" and a
   "Manual review required" flag (PART 5 · Unsupported and blocked).

   Each STAR carries: Situation, Task, Action, Result, a Supporting
   source (provenance), a Confidence level, and an interview-safety
   label — Safe to discuss / Needs preparation / Unsupported and
   blocked — every one tracing to the master resume, profile,
   employment history, or the submitted application package.
   ============================================================ */

const StarLibrary = (() => {

  const lc = s => String(s || '').toLowerCase();
  const hasMetric = s => /\d/.test(String(s || ''));

  /* the ten themes (PART 4). `keys` are the evidence matchers. */
  const SEEDS = [
    { id: 'zatca_psim',     label: 'ZATCA PSIM & systems integration', keys: ['zatca', 'psim', 'physical security', 'systems integration', 'integration'] },
    { id: 'stc_ops',        label: 'STC nationwide operations',        keys: ['stc', 'nationwide', 'network operations', 'operations centre', 'operations center', 'noc', 'operations'] },
    { id: 'g20_hajj',       label: 'G20 & Hajj delivery',              keys: ['g20', 'hajj', 'mega event', 'mega-event', 'event delivery'] },
    { id: 'vendor',         label: 'Vendor coordination',              keys: ['vendor', 'supplier', 'third-party', 'third party', 'oem', 'contractor', 'partner'] },
    { id: 'incident',       label: 'Incident & problem management',    keys: ['incident', 'problem management', 'outage', 'root cause', 'rca', 'itil', 'major incident'] },
    { id: 'risk',           label: 'Risk management',                  keys: ['risk', 'mitigation', 'compliance', 'audit', 'controls'] },
    { id: 'stakeholder',    label: 'Stakeholder management',           keys: ['stakeholder', 'client', 'customer', 'executive', 'business unit', 'liaison'] },
    { id: 'handover',       label: 'Operational handover',             keys: ['handover', 'hand-over', 'transition', 'operational readiness', 'runbook', 'onboarding'] },
    { id: 'troubleshooting', label: 'Complex troubleshooting',         keys: ['troubleshoot', 'debug', 'diagnose', 'root cause', 'resolve', 'remediat'] },
    { id: 'leadership',     label: 'Team leadership',                  keys: ['lead', 'led', 'mentor', 'managed', 'supervis', 'team of', 'coached'] },
  ];

  /* gather every piece of traceable evidence the user has */
  function evidencePool(profile, memory) {
    const pool = [];
    const p = profile || {};
    const master = (typeof TailorEngine !== 'undefined') ? TailorEngine.masterContent(p) : { roles: [], summarySentences: [] };

    (master.roles || []).forEach(role => {
      (role.bullets || []).forEach(b => pool.push({
        text: b, source: `${role.company}${role.period ? ' · ' + role.period : ''}`,
        role, where: 'resume', strength: 'safe',
      }));
    });
    (master.summarySentences || []).forEach(s => pool.push({
      text: s, source: 'Profile summary', where: 'summary', strength: 'prep',
    }));
    if (memory && memory.submitted && memory.submitted.answers) {
      memory.submitted.answers.filter(a => a.supported && a.answer).forEach(a => pool.push({
        text: a.answer, source: `Submitted answer · ${a.question}`, where: 'answer', strength: 'prep',
      }));
    }
    return pool;
  }

  function buildOne(seed, pool) {
    const matches = pool.filter(e => seed.keys.some(k => lc(e.text).includes(k)));
    if (!matches.length) {
      return {
        id: seed.id, theme: seed.label,
        situation: '', task: '', action: '', result: '',
        source: null, confidence: 'Unsupported', safety: 'blocked',
        flag: 'Manual review required',
        note: 'No supporting evidence in your profile, employment history, master resume, or submitted application — add a real example before using this.',
      };
    }
    const resumeMatches = matches.filter(m => m.where === 'resume');
    const strong = matches.find(m => m.where === 'resume' && hasMetric(m.text))
      || resumeMatches[0] || matches[0];
    const actions = matches.filter(m => m !== strong).slice(0, 2);
    const safety = resumeMatches.length ? 'safe' : 'prep';
    const confidence = resumeMatches.length
      ? (hasMetric(strong.text) ? 'High' : 'Medium')
      : 'Needs preparation';

    return {
      id: seed.id, theme: seed.label,
      /* Situation/Task are neutral factual framing; Action/Result are
         VERBATIM traceable content — nothing is invented. */
      situation: strong.role ? `${strong.role.company}${strong.role.period ? ` (${strong.role.period})` : ''}` : strong.source,
      task: seed.label,
      action: (actions.length ? actions : [strong]).map(m => m.text).join(' '),
      result: hasMetric(strong.text) ? strong.text : `${strong.text}  (quantify the outcome before the interview).`,
      source: Array.from(new Set(matches.map(m => m.source))).join('  ·  '),
      confidence, safety,
      flag: safety === 'prep' ? 'Verify wording before the interview' : null,
      note: safety === 'safe'
        ? 'Traces verbatim to your master resume / employment history — safe to discuss.'
        : 'Drawn from your profile summary or submitted answers — rehearse the specifics.',
    };
  }

  function build(profile, memory) {
    const pool = evidencePool(profile, memory);
    return SEEDS.map(seed => buildOne(seed, pool));
  }

  function summary(stars) {
    return {
      total: stars.length,
      safe: stars.filter(s => s.safety === 'safe').length,
      prep: stars.filter(s => s.safety === 'prep').length,
      blocked: stars.filter(s => s.safety === 'blocked').length,
    };
  }

  return { SEEDS, build, summary, evidencePool };
})();
