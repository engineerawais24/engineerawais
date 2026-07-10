/* ============================================================
   MasterResume — real master-resume import (Sprint 6).
   Accepts PDF or DOCX, stores the file as base64 in
   localStorage (MVP; S3/R2 replaces this with the backend).
   Used by the Profile page (upload card) and the Resume
   Library (primary source for the preview + downloads).
   ============================================================ */

const MasterResume = (() => {

  const KEY = 'careerpilot_master_resume_v1';
  const MAX_BYTES = 2.5 * 1024 * 1024;   // localStorage-safe cap

  const TYPES = {
    pdf:  { mime: 'application/pdf', label: 'PDF' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX' },
  };

  let cachedUrl = null;   // blob: URL for the stored file (per session)

  /* ---------- storage ---------- */

  function get() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* Validate + persist a record. Also the programmatic import
     path (tests / future backend sync). Returns true on success. */
  function importRecord(rec) {
    if (!rec || !TYPES[rec.kind] || !rec.name || !rec.data) {
      toast('Only PDF or DOCX files are supported', 'error');
      return false;
    }
    if (rec.size > MAX_BYTES) {
      toast('File too large — 2.5 MB max while storage is in-browser', 'error');
      return false;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(rec));
    } catch (e) {
      toast('Could not save — browser storage is full', 'error');
      return false;
    }
    clearUrl();
    return true;
  }

  function remove(force) {
    if (!force && !confirm('Remove the uploaded master resume?')) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    clearUrl();
    toast('Master resume removed', 'info');
    refresh();
  }

  /* ---------- file intake (picker + drag-and-drop) ---------- */

  function kindOf(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || file.type === TYPES.pdf.mime) return 'pdf';
    if (ext === 'docx' || file.type === TYPES.docx.mime) return 'docx';
    return null;
  }

  function handleFile(file) {
    if (!file) return;
    const kind = kindOf(file);
    if (!kind) { toast('Only PDF or DOCX files are supported', 'error'); return; }
    if (file.size > MAX_BYTES) { toast('File too large — 2.5 MB max while storage is in-browser', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const rec = { name: file.name, kind, mime: TYPES[kind].mime, size: file.size, uploadedAt: Date.now(), data: reader.result };
      if (importRecord(rec)) {
        toast(`Master resume imported — ${file.name}`);
        refresh();
      }
    };
    reader.onerror = () => toast('Could not read that file', 'error');
    reader.readAsDataURL(file);
  }

  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,' + TYPES.pdf.mime + ',' + TYPES.docx.mime;
    input.onchange = () => handleFile(input.files && input.files[0]);
    input.click();
  }

  function dragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function dragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
  }

  function drop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  }

  /* ---------- export ---------- */

  function blobUrl() {
    const m = get();
    if (!m) return null;
    if (cachedUrl) return cachedUrl;
    const b64 = m.data.split(',')[1] || '';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    cachedUrl = URL.createObjectURL(new Blob([bytes], { type: m.mime }));
    return cachedUrl;
  }

  function clearUrl() {
    if (cachedUrl) { URL.revokeObjectURL(cachedUrl); cachedUrl = null; }
  }

  function download() {
    const m = get();
    if (!m) return;
    const a = document.createElement('a');
    a.href = blobUrl();
    a.download = m.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(`Downloading ${m.name}`);
  }

  /* ---------- display helpers ---------- */

  function fmtSize(bytes) {
    return bytes < 1048576
      ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
      : (bytes / 1048576).toFixed(1) + ' MB';
  }

  function fmtDate(t) {
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function refresh() {
    if (typeof navigate === 'function') navigate();
  }

  return {
    KEY, MAX_BYTES,
    get, importRecord, remove,
    pick, drop, dragOver, dragLeave,
    blobUrl, download,
    fmtSize, fmtDate,
  };
})();
