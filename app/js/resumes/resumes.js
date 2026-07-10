/* ============================================================
   Resumes — controller for the Resume Builder screen.
   Owns document state (variants, cover letters, selection),
   the mock generation flows, and export (print-to-PDF, copy).
   Rendering is delegated to ResumesView, persistence to
   ResumesStore, live inputs come from Profile + Applications.
   ============================================================ */

const Resumes = (() => {

  let docs = ResumesStore.load();
  const ui = {
    tab: 'resume',            // 'resume' | 'cover'
    appId: docs.lastAppId,    // selected application
    activeVariantId: null,    // variant loaded into the preview
  };

  /* ---------- state assembly ---------- */

  function apps() {
    return (typeof Applications !== 'undefined') ? Applications.getItems() : [];
  }

  function currentApp() {
    const list = apps();
    return list.find(a => a.id === ui.appId) || list[0] || null;
  }

  /* Compare the role's expected keywords with Profile skills. */
  function suggestionsFor(app) {
    if (!app) return null;
    const kws = ResumesStore.keywordsFor(app.position);
    const skills = Profile.getState().skills.map(s => s.toLowerCase());
    const matched = kws.filter(k => skills.some(s => s === k.toLowerCase() || s.includes(k.toLowerCase()) || k.toLowerCase().includes(s)));
    const missing = kws.filter(k => !matched.includes(k));
    const tips = [
      `Mirror the exact title “${app.position}” in your headline.`,
      `Lead your top bullets with outcomes ${app.company} cares about — numbers first.`,
      matched.length
        ? `Front-load ${matched.slice(0, 2).join(' and ')} — the matcher found them in this role's description.`
        : 'Add the missing keywords to your Profile skills — only the ones you genuinely have.',
    ];
    return { kws, matched, missing, tips };
  }

  function state() {
    const app = currentApp();
    return {
      apps: apps(),
      appId: app ? app.id : null,
      app,
      sugg: suggestionsFor(app),
      docs,
      tab: ui.tab,
      activeVariantId: ui.activeVariantId,
      variant: docs.variants.find(v => v.id === ui.activeVariantId) || null,
      profile: Profile.getState(),
      letter: app ? docs.coverLetters[app.id] : null,
      master: MasterResume.get(),
    };
  }

  function render() {
    return ResumesView.render(state());
  }

  function refresh() {
    if (currentRoute() === 'resumes') navigate();
  }

  /* ---------- selection ---------- */

  function selectApp(id) {
    ui.appId = id;
    ui.activeVariantId = null;      // suggestions now target the new job
    docs.lastAppId = id;
    ResumesStore.save(docs);
    refresh();
  }

  function setTab(tab) {
    ui.tab = tab;
    refresh();
  }

  function loadVariant(id) {
    ui.activeVariantId = id;
    ui.tab = 'resume';
    const v = docs.variants.find(x => x.id === id);
    if (v && v.appId && apps().some(a => a.id === v.appId)) ui.appId = v.appId;
    refresh();
  }

  /* ---------- generation (mock — real AI arrives with the backend) ---------- */

  function generateResume() {
    const app = currentApp();
    if (!app) { toast('Add an application to the board first'); return null; }
    const sugg = suggestionsFor(app);
    const ats = Math.min(96, 82 + sugg.matched.length * 3);
    const version = docs.variants.filter(v => v.appId === app.id).length + 1;
    const variant = {
      id: 'var-' + Date.now(),
      company: app.company,
      title: app.position,
      meta: `${sugg.matched.length + 8} keywords matched · v${version} · just now`,
      ats,
      appId: app.id,
    };
    docs.variants.unshift(variant);
    ui.activeVariantId = variant.id;
    ui.tab = 'resume';
    ResumesStore.save(docs);
    refresh();
    toast(`Tailored resume generated for ${app.company} — ATS ${ats} (mock)`);
    return variant;
  }

  function generateCover() {
    const app = currentApp();
    if (!app) { toast('Add an application to the board first'); return null; }
    const p = Profile.getState();
    const sugg = suggestionsFor(app);
    const name = `${p.personal.firstName} ${p.personal.lastName}`.trim();
    const strengths = (sugg.matched.length ? sugg.matched : p.skills).slice(0, 3).join(', ');
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const letter =
`${today}

Dear ${app.company} Hiring Team,

I'm writing to apply for the ${app.position} role. As a ${p.personal.headline.toLowerCase() || 'solutions engineer'} based in ${p.contact.city || 'Karachi'}, I've spent the last several years owning technical delivery end-to-end — from discovery workshops to production rollout — and ${app.company} is exactly the kind of team I want to do that for next.

My strongest overlap with this role: ${strengths}. Most recently I designed Terraform-based Azure landing zones that cut client onboarding from three weeks to four days, and delivered 14 proof-of-concepts with a 64% conversion rate. I work the way strong solutions teams do — write it down, keep the ego low, own the outcome.

I'd welcome the chance to talk about how I can help ${app.company}'s customers succeed. My resume is attached; I'm available for a conversation at your convenience.

Sincerely,
${name}
${p.contact.email}${p.links.linkedin ? '\n' + p.links.linkedin : ''}`;

    docs.coverLetters[app.id] = letter;
    ui.tab = 'cover';
    ResumesStore.save(docs);
    refresh();
    toast(`Cover letter drafted for ${app.company} (mock)`);
    return letter;
  }

  /* ---------- export: plain text ---------- */

  function plainText(tab) {
    const s = state();
    if ((tab || ui.tab) === 'cover') {
      return s.letter || '';
    }
    const p = s.profile;
    const name = `${p.personal.firstName} ${p.personal.lastName}`.trim().toUpperCase();
    const lines = [
      name,
      s.variant ? s.variant.title : p.personal.headline,
      [p.contact.email, p.contact.phone, p.contact.city, p.links.linkedin].filter(Boolean).join(' · '),
      '',
      'SUMMARY', p.personal.summary, '',
      'SKILLS', p.skills.join(' · '), '',
      'EXPERIENCE',
      ...ResumesStore.EXPERIENCE.flatMap(x => [
        `${x.title} — ${x.company} (${x.period})`,
        ...x.bullets.map(b => `- ${b}`), '',
      ]),
      'CERTIFICATIONS',
      ...p.certifications.filter(c => c.name).map(c => `${c.name} — ${c.issuer} (${c.year})`), '',
      'LANGUAGES', p.languages.filter(l => l.name).map(l => `${l.name} (${l.level})`).join(' · '), '',
      'EDUCATION',
      ...ResumesStore.EDUCATION.map(e => `${e.degree} — ${e.school}, ${e.year}`),
    ];
    return lines.join('\n');
  }

  /* ---------- export: copy to clipboard ---------- */

  function writeClipboard(text) {
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* best effort */ }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    legacy();
    return Promise.resolve();
  }

  function copy() {
    writeClipboard(plainText()).then(() => {
      toast(ui.tab === 'cover' ? 'Cover letter copied as plain text' : 'Resume copied as plain text');
    });
  }

  /* ---------- export: print-to-PDF ---------- */

  function printableHtml(tab) {
    const s = state();
    const which = tab || ui.tab;
    const name = `${s.profile.personal.firstName} ${s.profile.personal.lastName}`.trim();
    const body = which === 'cover'
      ? ResumesView.coverPaper(s.letter || '', s.app)
      : ResumesView.resumePaper(s.profile, s.variant, s.sugg ? s.sugg.matched : []);
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${name} — ${which === 'cover' ? 'Cover Letter' : 'Resume'}</title>
<style>
  body{ margin:0; padding:32px; font-family:'Segoe UI',system-ui,sans-serif; color:#1A1712; }
  .paper{ max-width:720px; margin:0 auto; }
  .rp-name{ font-size:26px; font-weight:700; letter-spacing:-.02em; }
  .rp-headline{ font-size:14px; color:#3538CD; font-weight:600; margin-top:2px; }
  .rp-contact{ font-size:11px; color:#57503F; margin-top:6px; }
  .rp-sec{ font-size:10px; letter-spacing:.14em; color:#3538CD; font-weight:700; margin:18px 0 6px; border-bottom:1px solid #E6E0D4; padding-bottom:4px; }
  .rp-text{ font-size:12px; line-height:1.6; margin:0; }
  .rp-skills span{ display:inline-block; font-size:11px; border:1px solid #E6E0D4; border-radius:4px; padding:2px 7px; margin:0 4px 4px 0; }
  .rp-skills .hl{ background:#ECEDFB; border-color:#D9DBF6; font-weight:600; }
  .rp-job{ margin-bottom:10px; }
  .rp-job-head{ font-size:12.5px; }
  .rp-period{ float:right; font-size:11px; color:#8B8272; }
  .rp-job ul{ margin:4px 0 0; padding-left:18px; font-size:12px; line-height:1.55; }
  .rp-cols{ display:flex; gap:32px; }
  .rp-letter p{ font-size:12.5px; line-height:1.7; }
  .paper-empty, .btn{ display:none; }
  @page{ margin:14mm; }
</style></head>
<body>${body}</body></html>`;
  }

  function download() {
    /* un-tailored master with an uploaded PDF: the original file
       IS the resume — download it directly instead of printing */
    const m = MasterResume.get();
    if (ui.tab === 'resume' && !ui.activeVariantId && m && m.kind === 'pdf') {
      MasterResume.download();
      return;
    }
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(printableHtml());
    doc.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 2000);
    }, 150);
    toast('Print dialog opened — choose “Save as PDF”');
  }

  return {
    render,
    selectApp, setTab, loadVariant,
    generateResume, generateCover,
    copy, download,
    plainText, printableHtml, suggestionsFor, getDocs: () => docs,
  };
})();
