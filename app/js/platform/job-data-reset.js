/* ============================================================
   JobDataReset — one permanent "clear all job data" reset.

   Wipes every store that holds JOB data and leaves everything personal
   untouched. It exists so that clearing the app is a single, reviewable,
   repeatable operation instead of a hand-written list of localStorage keys
   that silently rots the moment a module renames its key.

   HOW IT STAYS CORRECT
   --------------------
   It never hard-codes a storage key. Each target names the MODULE that owns
   the data, and the key is read off that module at run time
   (`Mod.STORAGE_KEY` / `Mod.KEY`), preferring the module's own `clear()` when
   it has one. Rename a key in its module and this reset follows it. A module
   that isn't loaded is reported as `absent`, never silently skipped.

   WHAT IT CLEARS
   --------------
     Today's Jobs + imported jobs · saved-job applications · approvals and
     prepared packages · the Application Queue · applied / skipped / needs-
     attention history · tracker records · job activity · discovery and search
     results and their counts.

   WHAT IT NEVER TOUCHES
   ---------------------
     Profile and personal info · employment and certifications · the résumé
     library, master résumé, parsed résumé and default résumé · preferences and
     settings · SAVED SEARCH URLS · backend configuration · the pre-import and
     pre-sync safety backups.

   `JobFetchStore` is deliberately NOT cleared with its own `clear()`: that
   would take the saved search URLs with it. Only the last run's counts go.
   ============================================================ */

const JobDataReset = (() => {

  /* bumped only if a future reset must run again on already-reset installs */
  const FLAG_KEY = 'careerpilot_job_data_reset_v1';

  /* Every module here is declared with a top-level `const`, which creates a
     LEXICAL global — it is NOT a property of `window`. So they are referenced by
     identifier behind a `typeof` guard (the idiom the rest of the app uses);
     looking them up as `window[name]` finds nothing and would silently skip
     every store. `mod` is the live module, so its key is read from the module
     itself and never copied into this file. */
  function targets() {
    const t = (name, m, label) => ({ module: name, mod: m || null, label });
    return [
      t('JobsStore',           typeof JobsStore           !== 'undefined' ? JobsStore           : null, "Today's Jobs board (decisions + discovered)"),
      t('ImportedJobs',        typeof ImportedJobs        !== 'undefined' ? ImportedJobs        : null, 'Imported / saved jobs'),
      t('ApplicationPackages', typeof ApplicationPackages !== 'undefined' ? ApplicationPackages : null, 'Prepared application packages'),
      t('ApplicationQueue',    typeof ApplicationQueue    !== 'undefined' ? ApplicationQueue    : null, 'Application Queue (+ applied/skipped/attention)'),
      t('ApplicationsStore',   typeof ApplicationsStore   !== 'undefined' ? ApplicationsStore   : null, 'Applications board'),
      t('PrepStore',           typeof PrepStore           !== 'undefined' ? PrepStore           : null, 'Prepared application review data'),
      t('SubmissionStore',     typeof SubmissionStore     !== 'undefined' ? SubmissionStore     : null, 'Submitted / applied history'),
      /* interview-store.js exports ApplicationMemory, NOT an `InterviewStore` —
         naming it wrong here would silently skip the applied/interview history */
      t('ApplicationMemory',   typeof ApplicationMemory   !== 'undefined' ? ApplicationMemory   : null, 'Application + interview memory'),
      t('Activity',            typeof Activity            !== 'undefined' ? Activity            : null, 'Job activity timeline'),
      t('CoverLetter',         typeof CoverLetter         !== 'undefined' ? CoverLetter         : null, 'Per-job cover letter drafts'),
      t('ResumeRecommender',   typeof ResumeRecommender   !== 'undefined' ? ResumeRecommender   : null, 'Per-job résumé overrides'),
      t('JobCache',            typeof JobCache            !== 'undefined' ? JobCache            : null, 'Cached jobs'),
      t('SearchCache',         typeof SearchCache         !== 'undefined' ? SearchCache         : null, 'Cached search results'),
      t('SyncLog',             typeof SyncLog             !== 'undefined' ? SyncLog             : null, 'Sync log'),
    ];
  }

  function fetchStore() {
    return (typeof JobFetchStore !== 'undefined') ? JobFetchStore : null;
  }

  /* named so a reader can check the guarantee, and so the test can assert it */
  const PRESERVED = [
    'ProfileStore (profile + personal info)',
    'employment + certifications (inside the profile)',
    'ResumesStore (résumé library)',
    'MasterResume (master résumé)',
    'ParsedResume (parsed résumé)',
    'Backend config (careerpilot_backend_cfg)',
    'Preferences / settings',
    'JobFetchStore.searches (saved search URLs)',
    'SavedSearches (saved board filters)',
    'pre_import_backup + profile_pre_sync_backup (safety backups)',
  ];

  function keyOf(m) {
    if (!m) return null;
    return m.STORAGE_KEY || m.KEY || null;
  }

  /* Remove one key from wherever it lives. Short keys belong to AppStorage
     (namespaced); `careerpilot_*` keys are written straight to localStorage.
     Both are attempted — removing a key that isn't there is a no-op — so a
     module that changes storage layer can't slip through. */
  function removeKey(key) {
    let removed = false;
    try {
      if (typeof AppStorage !== 'undefined' && AppStorage.remove) {
        if (AppStorage.get(key) != null) removed = true;
        AppStorage.remove(key);
      }
    } catch (e) { /* keep going — the raw removal below still applies */ }
    try {
      if (typeof localStorage !== 'undefined') {
        if (localStorage.getItem(key) != null) removed = true;
        localStorage.removeItem(key);
      }
    } catch (e) { /* storage unavailable */ }
    return removed;
  }

  /* clear one target, preferring the module's own clear() */
  function clearTarget(t) {
    const m = t.mod;
    if (!m) return { module: t.module, label: t.label, status: 'absent', key: null };
    const key = keyOf(m);
    let how = 'key';
    try {
      if (typeof m.clear === 'function') { m.clear(); how = 'module.clear()'; }
    } catch (e) {
      how = 'key (clear() threw: ' + ((e && e.message) || 'error') + ')';
    }
    /* always follow up by removing the key: some clear() implementations write
       an empty value rather than removing, and a few modules have no clear() */
    if (key) removeKey(key);
    return { module: t.module, label: t.label, status: 'cleared', key: key, via: how };
  }

  /* the saved search URLs must survive — only the last run's counts go */
  function clearFetchCounts() {
    const m = fetchStore();
    if (!m) return { module: 'JobFetchStore', label: 'Discovery run counts', status: 'absent', key: null };
    const key = keyOf(m);
    let kept = 0, had = false;
    try {
      const state = (typeof AppStorage !== 'undefined') ? AppStorage.get(key) : null;
      if (state && typeof state === 'object') {
        had = !!state.lastRun;
        state.lastRun = null;
        kept = Object.keys(state.searches || {}).filter(p => state.searches[p]).length;
        if (typeof AppStorage !== 'undefined') AppStorage.set(key, state);
      }
    } catch (e) { /* leave it alone rather than risk the saved URLs */ }
    return {
      module: 'JobFetchStore', label: 'Discovery run counts (saved search URLs kept)',
      status: had ? 'cleared' : 'already empty', key: key, keptSearchUrls: kept,
    };
  }

  /* DB.approvals / DB.applications are in-memory arrays rebuilt from data.js on
     every load; a reset mid-session must empty the live ones too */
  function clearRuntime() {
    const out = [];
    try {
      if (typeof DB !== 'undefined' && DB) {
        if (Array.isArray(DB.approvals)) { out.push('DB.approvals (' + DB.approvals.length + ')'); DB.approvals.length = 0; }
        if (Array.isArray(DB.applications)) { out.push('DB.applications (' + DB.applications.length + ')'); DB.applications.length = 0; }
        if (Array.isArray(DB.jobs)) { out.push('DB.jobs (' + DB.jobs.length + ')'); DB.jobs.length = 0; }
      }
    } catch (e) { /* no DB in this context */ }
    return out;
  }

  /* ---------- the reset ---------- */

  function run() {
    const at = Date.now();
    const results = targets().map(clearTarget);
    results.push(clearFetchCounts());
    const runtime = clearRuntime();

    return {
      ok: true, at,
      cleared: results.filter(r => r.status === 'cleared').length,
      absent: results.filter(r => r.status === 'absent').map(r => r.module),
      results, runtime, preserved: PRESERVED.slice(),
    };
  }

  /* what the four screens report right now — used to verify a reset */
  function counts() {
    const n = (fn, d) => { try { const v = fn(); return v == null ? d : v; } catch (e) { return d; } };
    return {
      todaysJobs: n(() => (typeof Jobs !== 'undefined' ? Jobs.evaluated().length : 0), 0),
      importedJobs: n(() => (typeof ImportedJobs !== 'undefined' ? ImportedJobs.all().length : 0), 0),
      approvals: n(() => (typeof DB !== 'undefined' && DB.approvals ? DB.approvals.length : 0), 0),
      packages: n(() => (typeof ApplicationPackages !== 'undefined' ? ApplicationPackages.all().length : 0), 0),
      applications: n(() => (typeof Applications !== 'undefined' ? Applications.getItems().length : 0), 0),
      queue: n(() => (typeof ApplicationQueue !== 'undefined' ? (ApplicationQueue.approved() || []).length : 0), 0),
    };
  }

  /* ---------- the one-time automatic run ---------- */

  function hasRun() {
    try { return !!localStorage.getItem(FLAG_KEY); } catch (e) { return false; }
  }

  function markRun(report) {
    try {
      localStorage.setItem(FLAG_KEY, JSON.stringify({
        at: report.at, cleared: report.cleared, absent: report.absent,
      }));
    } catch (e) { /* if the marker can't be written the reset would repeat — harmless */ }
  }

  /* Runs the reset EXACTLY ONCE per install, on app load. After that the flag
     stays and this is a no-op; `run()` is still available on demand. */
  function runOnce() {
    if (hasRun()) return { skipped: true, reason: 'already run' };
    const report = run();
    markRun(report);
    try {
      console.log('[CareerPilot] job data reset — cleared ' + report.cleared + ' store(s)', report);
    } catch (e) { /* no console */ }
    return report;
  }

  return { FLAG_KEY, targets, PRESERVED, run, runOnce, hasRun, counts, keyOf };
})();
