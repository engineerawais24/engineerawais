/* ============================================================
   ResumeParsing — the controller for parse → review → approve
   (Sprint 28).

   It reads the uploaded master résumé, parses it locally, and lets
   the user correct the result before any of it reaches the profile.
   The uploaded file is never modified and never leaves the browser.
   ============================================================ */

const ResumeParsing = (() => {

  const ui = {
    selected: {},        // path → apply this field?
    recoveryOpen: false, // the certification-recovery preview
  };

  function refresh() {
    if (typeof navigate === 'function' && typeof currentRoute === 'function') {
      const r = currentRoute();
      if (r === 'resumeReview' || r === 'resumes') navigate();
      else if (typeof renderNav === 'function') renderNav();
    }
  }

  /* Default the confirmation SAFELY (Sprint 28 fix): additive fields (skills,
     certifications) are ticked because they can only add, never delete. A
     scalar field the user has personally set is left unticked — they have to
     ask for it to be overwritten. */
  function selectChanged() {
    ui.selected = {};
    if (typeof ParsedResume === 'undefined') return ui.selected;
    ParsedResume.defaultSelection().forEach(p => { ui.selected[p] = true; });
    return ui.selected;
  }

  function render() {
    if (typeof ParsedResume === 'undefined' || typeof ParsingView === 'undefined') return '';
    return ParsingView.review(ParsedResume.load(), ui.selected);
  }

  /* ---------- parse ---------- */

  async function parse() {
    if (typeof MasterResume === 'undefined' || typeof ParsedResume === 'undefined') return null;
    const file = MasterResume.get();
    if (!file) {
      if (typeof toast === 'function') toast('Upload a master résumé on the Profile page first', 'error');
      return null;
    }

    const source = { name: file.name, kind: file.kind, size: file.size };
    ParsedResume.begin(source);
    refresh();

    const res = await ResumeParser.parse(file);
    if (!res.ok) {
      ParsedResume.fail(res.code, res.error);
      if (typeof toast === 'function') toast(res.error, 'error');
      refresh();
      return res;
    }

    /* a partial extraction is still reviewable — that is what the screen is for */
    const extracted = ResumeExtractor.extract(res.text);
    ParsedResume.complete(extracted, source);
    selectChanged();
    if (typeof toast === 'function') {
      toast(`Parsed ${file.name} — ${extracted.completeness}% extracted. Review it before it touches your profile.`);
    }
    if (typeof location !== 'undefined') location.hash = '#/resumeReview';
    refresh();
    return { ok: true, extracted };
  }

  async function reparse() {
    ParsedResume.clear();
    ui.selected = {};
    return parse();
  }

  /* ---------- review edits ---------- */

  function setField(path, value) {
    ParsedResume.setField(path, value);
    /* the comparison depends on the edited value, so re-derive the defaults
       for any field the user has not made a decision about yet */
    const changed = ParsedResume.defaultSelection();
    Object.keys(ui.selected).forEach(p => { if (changed.indexOf(p) === -1) delete ui.selected[p]; });
    changed.forEach(p => { if (!(p in ui.selected)) ui.selected[p] = true; });
    /* no re-render: it would move the caret out of the field being typed in */
  }

  function addSkill() {
    const el = document.getElementById('rp-skill-new');
    const v = el ? el.value : '';
    if (!String(v || '').trim()) return;
    ParsedResume.addSkill(v);
    selectChanged();
    refresh();
  }

  function removeSkill(skill) {
    ParsedResume.removeSkill(skill);
    selectChanged();
    refresh();
  }

  function setEmployment(index, key, value) {
    const patch = {};
    if (key === 'endDate') {
      patch.current = /present|current|now/i.test(String(value || ''));
      patch.endDate = patch.current ? '' : value;
    } else {
      patch[key] = value;
    }
    ParsedResume.setEmployment(index, patch);
  }

  function removeEmployment(index) {
    ParsedResume.removeEmployment(index);
    selectChanged();
    refresh();
  }

  function addCertification() {
    const el = document.getElementById('rp-cert-new');
    const v = el ? el.value : '';
    if (!String(v || '').trim()) return;
    ParsedResume.addCertification({ name: v });
    selectChanged();
    refresh();
  }

  function setCertification(index, key, value) {
    const patch = {};
    patch[key] = value;
    ParsedResume.setCertification(index, patch);
  }

  function removeCertification(index) {
    ParsedResume.removeCertification(index);
    selectChanged();
    refresh();
  }

  /* ---------- confirm + approve ---------- */

  function toggleApply(path) {
    ui.selected[path] = !ui.selected[path];
    refresh();
  }

  function selectedPaths() {
    return Object.keys(ui.selected).filter(p => ui.selected[p]);
  }

  /* Approval applies ONLY the confirmed fields. Anything left unticked keeps
     whatever the profile already has — user edits are never overwritten. */
  function approve() {
    const paths = selectedPaths();
    const res = ParsedResume.approve(paths);
    if (!res.ok) {
      if (typeof toast === 'function') toast(res.error, 'error');
      return res;
    }
    if (typeof toast === 'function') {
      toast(paths.length
        ? `Approved — ${res.applied.length} profile field${res.applied.length === 1 ? '' : 's'} updated from your résumé`
        : 'Approved — your profile was left as it is');
    }
    refresh();
    return res;
  }

  function reopen() {
    ParsedResume.reopen();
    selectChanged();
    refresh();
    return ParsedResume.load();
  }

  /* Sprint 28 fix: put back any certification that was in the profile before
     the first sync and is no longer there. Purely additive. */
  function restoreCertifications() {
    const res = ParsedResume.restoreCertifications();
    if (typeof toast === 'function') {
      toast(res.restored
        ? `Restored ${res.restored} certification${res.restored === 1 ? '' : 's'} from before parsing`
        : 'Nothing to restore — every certification you had is still there', res.ok ? 'success' : 'error');
    }
    refresh();
    return res;
  }

  /* ---------- certification recovery: preview, then confirm ----------
     previewRecovery() only READS. Nothing is written to storage until
     applyRecovery() is pressed. */

  function previewRecovery() {
    ui.recoveryOpen = true;
    refresh();
    return (typeof CertRecovery !== 'undefined') ? CertRecovery.preview() : null;
  }

  function closeRecovery() {
    ui.recoveryOpen = false;
    refresh();
  }

  function applyRecovery() {
    if (typeof CertRecovery === 'undefined') return null;
    const res = CertRecovery.apply();
    if (typeof toast === 'function') {
      toast(res.ok
        ? (res.restored
          ? `Restored ${res.restored} certification${res.restored === 1 ? '' : 's'}${res.skipped ? ` · ${res.skipped} duplicate${res.skipped === 1 ? '' : 's'} skipped` : ''}`
          : 'Nothing to restore — every certification is already in your profile')
        : res.error, res.ok ? 'success' : 'error');
    }
    ui.recoveryOpen = false;
    refresh();
    return res;
  }

  return {
    ui, render, refresh, selectChanged, selectedPaths,
    parse, reparse,
    setField, addSkill, removeSkill,
    setEmployment, removeEmployment,
    addCertification, setCertification, removeCertification,
    toggleApply, approve, reopen, restoreCertifications,
    /* recovery */
    previewRecovery, closeRecovery, applyRecovery,
  };
})();
