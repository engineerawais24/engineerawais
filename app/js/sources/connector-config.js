/* ============================================================
   ConnectorConfig — secure configuration placeholders (9A).

   HARD RULE: no credentials in frontend code or storage. The
   browser stores only:
     endpoint    — the CareerPilot backend URL (https)
     apiKeyRef   — a REFERENCE to a backend secret,
                   e.g. 'env:BAYT_API_KEY' or 'secret:bayt/key'
     sessionRef  — a REFERENCE to backend-held session creds,
                   e.g. 'env:LINKEDIN_SESSION'
     useDemo     — demo fallback on/off (on by default)
     simulate    — dev-only state simulation for diagnostics

   Anything that does not look like a reference (env:/secret:/
   vault: prefix) is rejected at save time, so a pasted real
   API key can never be persisted.
   ============================================================ */

const ConnectorConfig = (() => {

  const KEY = 'careerpilot_connector_cfg_v1';

  const REF_RE = /^(env|secret|vault):[A-Za-z0-9_./-]+$/;
  const SIMULATE = ['none', 'failed', 'rate_limited', 'auth_required'];

  function blank() {
    return { useDemo: true, endpoint: '', apiKeyRef: '', sessionRef: '', simulate: 'none' };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
      return {};
    }
  }

  function persist(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }

  function get(id) {
    return Object.assign(blank(), load()[id] || {});
  }

  function isRef(v) {
    return v === '' || REF_RE.test(v);
  }

  /* validated write — returns { ok, error } */
  function set(id, partial) {
    const cfg = get(id);
    const next = Object.assign({}, cfg, partial);

    for (const field of ['apiKeyRef', 'sessionRef']) {
      const v = String(next[field] || '').trim();
      if (!isRef(v)) {
        return { ok: false, error: `${field} must be a reference like env:NAME — never paste the actual credential` };
      }
      next[field] = v;
    }
    const ep = String(next.endpoint || '').trim();
    if (ep && !/^https:\/\/.+/i.test(ep)) {
      return { ok: false, error: 'Backend endpoint must be an https:// URL' };
    }
    next.endpoint = ep;
    if (!SIMULATE.includes(next.simulate)) next.simulate = 'none';
    next.useDemo = !!next.useDemo;

    const all = load();
    all[id] = next;
    persist(all);
    return { ok: true, config: next };
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  return { KEY, SIMULATE, get, set, isRef, clear };
})();
