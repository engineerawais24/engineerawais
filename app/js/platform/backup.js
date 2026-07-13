/* ============================================================
   Backup — export and restore all CareerPilot data (Sprint 30).

   Everything CareerPilot knows lives in localStorage under a handful of
   `careerpilot_*` keys. This exports them as one JSON file and restores
   them back.

   The rules, because this is the one feature that can overwrite a life's
   worth of profile data:

     • export() only reads.
     • preview() only reads — it tells you exactly what a file contains
       and what it would change, and writes nothing.
     • restore() refuses to run without an explicit confirm flag.
     • restore() ALWAYS takes a full backup of the current data first,
       under careerpilot_platform.pre_import_backup, so an import can be
       undone.
     • a key present in the current data but absent from the file is left
       ALONE by default — a restore adds and replaces, it does not wipe.

   No schema change: the export is just the existing keys, verbatim.
   ============================================================ */

const Backup = (() => {

  const PREFIX = 'careerpilot_';
  const PRE_IMPORT_KEY = 'pre_import_backup';        // under the platform namespace
  const FORMAT = 'careerpilot.backup';
  const VERSION = 1;

  /* every key CareerPilot owns, right now */
  function keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) out.push(k);
    }
    return out.sort();
  }

  function bytes(k) {
    const v = localStorage.getItem(k);
    return v ? v.length : 0;
  }

  /* ---------- export (read-only) ---------- */

  function exportData() {
    const data = {};
    keys().forEach(k => { data[k] = localStorage.getItem(k); });
    return {
      format: FORMAT,
      version: VERSION,
      app: 'CareerPilot AI',
      appVersion: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '1.0',
      exportedAt: new Date().toISOString(),
      keyCount: Object.keys(data).length,
      data,
    };
  }

  function exportJson() { return JSON.stringify(exportData(), null, 2); }

  function download() {
    try {
      const blob = new Blob([exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `careerpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, keys: keys().length };
    } catch (e) {
      return { ok: false, error: 'Could not create the backup file — ' + ((e && e.message) || 'unknown error') };
    }
  }

  /* ---------- validate + preview (read-only) ---------- */

  function parse(json) {
    if (json && typeof json === 'object') return { ok: true, backup: json };
    try {
      const parsed = JSON.parse(String(json || ''));
      if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'That file is not a CareerPilot backup.' };
      return { ok: true, backup: parsed };
    } catch (e) {
      return { ok: false, error: 'That file is not valid JSON — it may be damaged or the wrong file.' };
    }
  }

  function validate(backup) {
    if (!backup || backup.format !== FORMAT) {
      return { ok: false, error: 'That is not a CareerPilot backup file.' };
    }
    if (!backup.data || typeof backup.data !== 'object') {
      return { ok: false, error: 'The backup contains no data.' };
    }
    const bad = Object.keys(backup.data).filter(k => k.indexOf(PREFIX) !== 0);
    if (bad.length) {
      return { ok: false, error: `The backup contains keys that are not CareerPilot's: ${bad.slice(0, 3).join(', ')}` };
    }
    if (!Object.keys(backup.data).length) {
      return { ok: false, error: 'The backup is empty — there is nothing to restore.' };
    }
    return { ok: true };
  }

  /* what WOULD happen — nothing is written */
  function preview(json) {
    const p = parse(json);
    if (!p.ok) return { ok: false, error: p.error };
    const v = validate(p.backup);
    if (!v.ok) return { ok: false, error: v.error };

    const backup = p.backup;
    const incoming = Object.keys(backup.data).sort();
    const current = keys();

    const replaced = incoming.filter(k => current.indexOf(k) !== -1
      && localStorage.getItem(k) !== backup.data[k]);
    const added = incoming.filter(k => current.indexOf(k) === -1);
    const identical = incoming.filter(k => current.indexOf(k) !== -1
      && localStorage.getItem(k) === backup.data[k]);
    /* keys you have that the file does not — a restore leaves these alone */
    const untouched = current.filter(k => incoming.indexOf(k) === -1);

    return {
      ok: true,
      backup,
      exportedAt: backup.exportedAt || null,
      appVersion: backup.appVersion || null,
      counts: {
        incoming: incoming.length,
        added: added.length,
        replaced: replaced.length,
        identical: identical.length,
        untouched: untouched.length,
      },
      added, replaced, identical, untouched,
      /* a human summary of the profile inside the file, so the user can tell
         WHOSE backup this is before they restore it */
      profile: profileSummary(backup),
    };
  }

  function profileSummary(backup) {
    try {
      const raw = backup.data[PREFIX + 'profile_v1'];
      if (!raw) return null;
      const p = JSON.parse(raw);
      return {
        name: `${(p.personal && p.personal.firstName) || ''} ${(p.personal && p.personal.lastName) || ''}`.trim(),
        email: (p.contact && p.contact.email) || '',
        employer: (p.employment && p.employment.company) || '',
        skills: (p.skills || []).length,
        certifications: (p.certifications || []).length,
      };
    } catch (e) {
      return null;
    }
  }

  /* ---------- pre-import backup ---------- */

  function preImportBackup() {
    const snapshot = exportData();
    snapshot.reason = 'pre-import';
    if (typeof AppStorage !== 'undefined') AppStorage.set(PRE_IMPORT_KEY, snapshot);
    return snapshot;
  }

  function lastPreImportBackup() {
    return (typeof AppStorage !== 'undefined') ? AppStorage.get(PRE_IMPORT_KEY) : null;
  }

  /* ---------- restore (writes — only when confirmed) ---------- */

  function restore(json, opts) {
    const o = opts || {};
    if (!o.confirm) {
      return { ok: false, error: 'A restore must be confirmed — nothing was written.' };
    }
    const plan = preview(json);
    if (!plan.ok) return plan;

    /* the current data is always saved first, so this can be undone */
    const backupOfNow = preImportBackup();

    const written = [];
    const failed = [];
    Object.keys(plan.backup.data).forEach(k => {
      try {
        localStorage.setItem(k, plan.backup.data[k]);
        written.push(k);
      } catch (e) {
        failed.push(k);
      }
    });

    if (failed.length) {
      return {
        ok: false,
        error: `Browser storage rejected ${failed.length} of ${written.length + failed.length} keys — it may be full. `
          + 'Your previous data is safe in the automatic pre-import backup.',
        written, failed, preImport: backupOfNow,
      };
    }

    return {
      ok: true,
      written,
      restored: written.length,
      untouched: plan.untouched,
      preImport: backupOfNow,
    };
  }

  /* undo the last restore */
  function undoRestore(opts) {
    const o = opts || {};
    if (!o.confirm) return { ok: false, error: 'Undoing a restore must be confirmed.' };
    const snap = lastPreImportBackup();
    if (!snap || !snap.data) return { ok: false, error: 'There is no pre-import backup to go back to.' };
    return restore(snap, { confirm: true });
  }

  function stats() {
    const ks = keys();
    return {
      keys: ks.length,
      bytes: ks.reduce((n, k) => n + bytes(k), 0),
      hasPreImport: !!lastPreImportBackup(),
    };
  }

  return {
    FORMAT, VERSION, PREFIX, PRE_IMPORT_KEY,
    keys, stats,
    exportData, exportJson, download,
    parse, validate, preview, profileSummary,
    preImportBackup, lastPreImportBackup,
    restore, undoRestore,
  };
})();
