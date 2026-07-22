# CareerPilot AI — Operating Instructions

This file is loaded automatically at the start of **every** session, for **every**
model. It is the contract. Read it, then follow it.

---

## 1. The `career` trigger

When the user's message is `career` (alone, any casing), or they say anything like
"pick up where we left off":

1. Read [HANDOFF.md](HANDOFF.md) — the single source of truth for project state.
2. Run `git log --oneline -5` and `git status` to confirm reality matches it.
3. Summarize in 3–5 lines: what shipped last, what is in flight, what is next.
4. Continue from the **Next Up** section of the handoff. Do not restart, do not
   re-plan finished work, do not ask the user to re-explain the project.

## 2. Update the handoff — hard rule

**After every completed phase, sprint, or discrete activity, update
[HANDOFF.md](HANDOFF.md) before you tell the user you are done.** Not at the end of
the session — at the end of each unit of work. A finished task with a stale handoff
is an unfinished task.

Update these sections: `Current State`, `Next Up`, `Open Issues`, and add a line to
`Sprint Log`. Keep it factual and short. Delete stale entries rather than letting
them pile up. **Then commit and push** (rule 2) so GitHub mirrors the latest state.

## 3. Hard rules — never violate

1. **Never expose secrets.** No keys, passwords, tokens, license keys, customer
   data, or internal IPs/hostnames in chat, commits, code, docs, or any vault.
   Admin/diagnostic UIs display **boolean status only** for secrets
   ("configured" / "missing") — never values. `.env` is never committed;
   `backend/.env.example` carries placeholders only.
2. **Auto-backup is ON — commit and push without asking.** The user gave standing
   authorization (2026-07-22) to keep GitHub as a live backup: after each completed
   unit of work, commit **and** `git push` to `origin/main` automatically, no
   approval prompt. This authorization does not weaken rule 1 or the §5 data-safety
   invariants — those are the guardrail. The push is only ever safe because
   `.gitignore` excludes `.env`, `*.db`, and `.claude/`; if you add anything
   sensitive, gitignore it **before** the next auto-push. Never `--force`-push.
3. **No AI attribution in commits.** No `Co-Authored-By: Claude`, no "Generated
   with Claude Code", no AI mention in commit messages or PR bodies.
4. **Full operating authority — never ask for approvals.** The user granted
   standing authorization (2026-07-22) to work without approval prompts:
   `permissions.defaultMode` is `bypassPermissions` in
   `.claude/settings.local.json` (a gitignored, local-only file). Proceed
   autonomously through edits, shell commands, tests, commits, and pushes — do not
   pause to ask the user to confirm. This authority **never** loosens rule 1
   (secrets), rule 2's push guardrails, or the §5 data-safety invariants; those
   remain the hard stops that make unattended operation safe. When an action is
   genuinely destructive or irreversible (wiping the real profile, deleting the
   local DB, force-pushing), stop and flag it anyway — the point of no prompts is
   speed on routine work, not skipping the §5 guardrails.

## 4. Project shape

**CareerPilot AI** — a local-first job-search and application assistant. Everything
runs in the browser by default; nothing leaves the machine unless the user
explicitly switches to backend mode.

- **Frontend** — `app/`. Vanilla JS, no build step, no framework, no bundler.
  Plain `<script src>` tags in [app/index.html](app/index.html), loaded in
  dependency order. Hash router + screen registry in
  [app/js/app.js](app/js/app.js). State persists to `localStorage`
  (`careerpilot_*_v1` keys).
- **Backend** — `backend/`. Python + FastAPI + SQLAlchemy + SQLite (Postgres-ready
  via `DATABASE_URL` alone). **Optional.** The app is fully usable with no backend
  running. Reads stay synchronous off a local mirror even in backend mode.
- **Entry point** — open [app/index.html](app/index.html) in a browser.
  The root `index.html` and `index_backup.html` are **dead legacy artifacts** from
  the first commit. Ignore them.

### Conventions to match

- Module pattern: IIFE exposing one global (`Jobs`, `Profile`, `JobsStore`, …).
  Per feature: a `-store.js` (data), a `-view.js` (HTML strings), and an entry file.
- No dependencies are added without asking. This project's value is that it has none.
- New scripts must be registered in `app/index.html` in correct load order.

### Running & testing

**There is no Node/JS runtime on this machine.** Python works (3.12 at the root
`.venv`, 3.13 in `backend/.venv`). The frontend needs no build — open
[app/index.html](app/index.html) in a browser.

Frontend tests are **browser harnesses**, one folder per sprint
(`app/tests/sprintN/sprintN.html`). They are executed with **headless Edge**:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
    --headless --disable-gpu --no-first-run `
    --user-data-dir=<ONE reused scratch profile> `
    --dump-dom "file:///.../app/tests/sprint30/sprint30.html"
# then read: <div id="summary">N/N passed
```

Hard-won specifics — ignore these and you will waste an hour:

- **Reuse ONE scratch `--user-data-dir`.** A fresh profile per harness intermittently
  wedges Edge. Wrap each run in a PowerShell `Start-Job` + `Wait-Job -Timeout` kill.
- **Async suites (25, 28)** finish *after* the DOM dump — run with
  `--enable-logging=stderr --v=0` and parse `[PASS]/[FAIL]/Sprint N:` from stderr.
- **Timer-driven suites (14, 16, 17)** need `--virtual-time-budget=20000`.
- **Sprint 18 has never run headlessly** — its async multi-source search never settles
  offline. Needs a real browser window. This is known, not a regression.

Backend (optional):

```powershell
cd backend; .\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000   # http://127.0.0.1:8000/docs
pytest                                       # throwaway temp SQLite per test
```

A change is not done until the affected browser harness is **green** and backend
`pytest` still passes.

### ⚠ Test harnesses share `file://` localStorage with the real app

A harness killed mid-run **can leave test data in — or wipe — the user's real
profile**. This has already destroyed the user's data once. Harnesses snapshot and
restore `localStorage` in a `finally` block; never kill one mid-run, and never point a
harness at the user's browser profile. The real data lives in **Chrome "Profile 4"**.

## 5. Data-safety invariants — these caused real damage once

The user's own résumé and career history are the live data. Demo data must **never**
bleed into a real profile. These must never regress:

- **`ProfileStore.defaults()` is blank.** The sample identity lives only in
  `ProfileStore.demo()`. Demo data never backfills a real profile.
  (Sprint 30 test case 1 exists to enforce exactly this.)
- **Profile sync from résumé parsing is additive.** Certifications, skills and history
  **merge, never replace**; unticked fields stay untouched; a pre-sync backup (max 5)
  is written to `careerpilot_platform.profile_pre_sync_backup`.
- **Backup/restore (Settings)** previews read-only, requires explicit confirmation, and
  takes a pre-import backup at `careerpilot_platform.pre_import_backup`.

Never commit real personal data, résumés, or the local `careerpilot.db`.
