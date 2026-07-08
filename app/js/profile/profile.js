/* ============================================================
   Profile — controller for the Career Profile screen.
   Owns the working state, dirty tracking, validation flow,
   and save/reset. Rendering is delegated to ProfileView,
   persistence to ProfileStore, rules to ProfileValidate.
   ============================================================ */

const Profile = (() => {

  let working  = ProfileStore.load();          // in-memory working copy
  let savedSnap = JSON.stringify(working);     // last persisted snapshot
  let errors   = {};                           // path -> message

  /* ---------- state helpers ---------- */

  function isDirty() {
    return JSON.stringify(working) !== savedSnap;
  }

  function getState() {
    return working;
  }

  function setField(path, value) {
    const [section, key] = path.split('.');
    working[section][key] = value;
    updateDirtyUI();
  }

  /* Completeness: coarse signals, not a grade — nudges the user
     toward the fields the matcher benefits from most. */
  function completeness() {
    const p = working;
    const signals = [
      p.personal.firstName.trim() && p.personal.lastName.trim(),
      p.personal.headline.trim(),
      p.personal.summary.trim().length > 30,
      p.contact.email.trim(),
      p.contact.phone.trim(),
      p.contact.city.trim() && p.contact.country.trim(),
      p.links.linkedin.trim(),
      p.employment.title.trim() && p.employment.company.trim(),
      p.skills.length >= 3,
      p.certifications.some(c => c.name.trim()),
      p.languages.some(l => l.name.trim()),
      p.preferences.targetRoles.trim(),
      p.preferences.locations.trim(),
      p.authorization.authorizedIn.trim(),
    ];
    const done = signals.filter(Boolean).length;
    return { done, total: signals.length, pct: Math.round(done / signals.length * 100) };
  }

  /* ---------- render / refresh ---------- */

  function render() {
    return ProfileView.render(working, errors, isDirty(), completeness());
  }

  /* Re-render the whole screen (only if the profile screen is showing). */
  function refresh() {
    if (currentRoute() === 'profile') navigate();
  }

  /* Re-render a single section card in place (keeps scroll position). */
  function refreshSection(id) {
    const el = document.getElementById('card-' + id);
    if (el) el.outerHTML = ProfileView.section(id, working, errors);
    updateDirtyUI();
  }

  /* Cheap dirty-state update: save bar flag + nav badge, no re-render. */
  function updateDirtyUI() {
    const flag = document.getElementById('dirty-flag');
    if (flag) {
      flag.classList.toggle('dirty', isDirty());
      flag.innerHTML = ProfileView.dirtyFlag(isDirty());
    }
    if (typeof renderNav === 'function') renderNav();
  }

  /* ---------- field events (wired from ProfileView) ---------- */

  function input(el, path) {
    const value = el.type === 'number' ? Number(el.value || 0) : el.value;
    setField(path, value);
    if (errors[path]) {                       // live-clear a fixed error
      delete errors[path];
      el.classList.remove('err');
      const ferr = el.closest('.field')?.querySelector('.ferr');
      if (ferr) ferr.remove();
    }
  }

  function check(el, path) {
    setField(path, el.checked);
  }

  /* ---------- skills ---------- */

  function addSkill() {
    const input = document.getElementById('skill-input');
    const v = (input?.value || '').trim();
    if (!v) return;
    if (working.skills.some(s => s.toLowerCase() === v.toLowerCase())) {
      toast('That skill is already on the list');
      return;
    }
    working.skills.push(v);
    refreshSection('skills');
    const next = document.getElementById('skill-input');
    if (next) next.focus();
  }

  function skillKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
  }

  function removeSkill(i) {
    working.skills.splice(i, 1);
    refreshSection('skills');
  }

  /* ---------- certifications ---------- */

  function addCert() {
    working.certifications.push({ name: '', issuer: '', year: '' });
    refreshSection('certifications');
  }

  function setCert(el, i, key) {
    working.certifications[i][key] = el.value;
    updateDirtyUI();
  }

  function removeCert(i) {
    working.certifications.splice(i, 1);
    refreshSection('certifications');
  }

  /* ---------- languages ---------- */

  function addLang() {
    working.languages.push({ name: '', level: 'Professional' });
    refreshSection('languages');
  }

  function setLang(el, i, key) {
    working.languages[i][key] = el.value;
    updateDirtyUI();
  }

  function removeLang(i) {
    working.languages.splice(i, 1);
    refreshSection('languages');
  }

  /* ---------- save / reset ---------- */

  function save() {
    errors = ProfileValidate.validate(working);
    const count = Object.keys(errors).length;
    if (count) {
      refresh();
      toast(`Please fix ${count} highlighted field${count > 1 ? 's' : ''}`);
      document.querySelector('.err')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (!ProfileStore.save(working)) {
      toast('Could not save — browser storage is unavailable');
      return false;
    }
    savedSnap = JSON.stringify(working);
    refresh();
    toast('Profile saved — stored in this browser');
    return true;
  }

  function reset(force) {
    if (!force && !confirm('Reset profile to defaults? Saved data in this browser will be cleared.')) return;
    ProfileStore.clear();
    working = ProfileStore.defaults();
    savedSnap = JSON.stringify(working);
    errors = {};
    refresh();
    toast('Profile reset to defaults');
  }

  /* Warn before losing unsaved edits on refresh / tab close. */
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  return {
    render, isDirty, getState, completeness, setField,
    input, check,
    addSkill, skillKey, removeSkill,
    addCert, setCert, removeCert,
    addLang, setLang, removeLang,
    save, reset,
  };
})();
