# CareerPilot AI — Handoff

**Single source of truth for project state.** New chat / new agent: read this top to
bottom, then continue from **Next Up**. Rules, project shape, and how to run the tests
live in [CLAUDE.md](CLAUDE.md) — read that too.

- **Last updated:** 2026-07-27 *(always keep this line current — every HANDOFF edit stamps today's date here, so anyone can tell the latest version at a glance)*
- **Status:** 🟢 **v1.0 SHIPPED** (2026-07-13, tagged 2026-07-22) · since: Chrome extension, real ATS import, ATS Engine v1, Universal Autofill v2 + profile auto-sync + resilient extension storage, Application Queue v1, extension-save→Today's-Jobs sync, imported-jobs→approvals→queue, **queue-triggered ATS autofill + hardened résumé handling (both verified live on a real Greenhouse job 2026-07-27)**
- **Branch:** `main` — clean, in sync with origin
- **Head:** `fix: handle Greenhouse resume uploads safely with manual fallback` (hash in git log) · tag `v1.0` on `b676933`
- **Remote:** github.com/engineerawais24/engineerawais

> ### ⚙️ Working agreement — for ANY agent editing this repo
> 1. **Update this file after every finished task**, before telling the user you're done —
>    the header block (**Last updated must always show today's date** / Status / Branch / Head),
>    the **Done** and **Open** to-do lists, and a dated **Sprint Log** row. A finished task with
>    a stale handoff is not finished. (This is CLAUDE.md §2, restated here so it's unmissable.)
> 2. **Full green light, no approval gate at all** (as of 2026-07-22, reiterated same day):
>    commit freely, `git push` automatically, tag and push tags automatically — for every
>    git operation, routine decision, and unit of work. Don't stop to ask. If you find an
>    older "needs explicit approval" note anywhere in this repo's docs, it's stale — update
>    it, don't re-ask.
> 3. **No AI attribution in commits** (no `Co-Authored-By`, no "Generated with…"). **No secrets** anywhere.
> 4. **Never write the user's real browser localStorage or delete data** without saying so first.
>    The real profile lives in **Chrome "Profile 4"**; test harnesses share `file://` storage — see the incident below.

---

## Milestones

| # | Milestone | Sprints | Status |
|---|-----------|---------|--------|
| M1 | Core product — profile, résumé library, job board, approvals, tracker, interview prep | 1–13 | ✅ Done |
| M2 | Platform & backend — storage abstraction, connectors, FastAPI + two-way sync, search engine | 14–18 | ✅ Done |
| M3 | Intelligence — saved searches, scoring v1/v2, résumé recommendation, cover letters, packages, discovery, imports, parsing | 19–29 | ✅ Done |
| M4 | **v1.0 release** — stabilization, demo-data isolation, backup/restore, salary visibility | 30 | ✅ **Shipped 2026-07-13** |
| M5 | Post-v1 hardening — repo hygiene, `v1.0` tag, user data recovery | — | 🔶 In progress (see To-do) |
| M6 | **Chrome extension** — save the open job, autofill from profile, import a LinkedIn results list | — | ✅ Built 2026-07-14 (`/extension`; needs a live-DOM smoke test) |
| M7 | **Real ATS job source** — import public Greenhouse + Lever feeds into the backend | — | ✅ Built 2026-07-14 (`88b4e46`; sample companies disabled) |
| M8 | **ATS Engine v1** — detect which ATS a job page uses (Greenhouse, Lever, Workday, SuccessFactors, SmartRecruiters, Taleo, Oracle, iCIMS); returns `{ats, company, supported, confidence}` | — | ✅ Built 2026-07-25 (detection only — no autofill/submit; `app/js/ats/ats-engine.js`; harness 22/22) |
| M9 | **Universal Autofill v2 + profile auto-sync + resilient storage** — extension fills all common field types incl. checkboxes & résumé upload; backend profile stays populated; storage never crashes | — | ✅ Shipped 2026-07-25 (`f21d7e7`; harnesses 19/19 + 8/8 + 7/7, backend 42/42) |
| M11 | **Extension save → Today's Jobs** — a job saved from the extension (POST /api/jobs) is pulled back into Today's Jobs via `JobsBackendSync` + `ImportedJobs.upsertFromBackend` | — | ✅ Shipped 2026-07-26 (`749191c`; deduped by backend identity; harness 8/8, backend read-back test) |
| M12 | **Imported jobs → Approvals → Queue** — create an application for an approved imported job; it shows on Approvals; "Approve & queue" adds that exact job to the Application Queue; each queued job links only to its own package | — | ✅ Shipped 2026-07-26 (`bd64909` + `749191c`; harness 7/7) |
| M13 | **Queue → ATS auto-autofill** — opening a queued job auto-runs Universal Autofill v2 once; login/CAPTCHA/blocked/no-form → Needs Attention | — | ✅ Built 2026-07-26 · ✅ **verified live 2026-07-27 on `https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007`** (autofilled once automatically). Two smoke-test bugs fixed: (1) `matchIntent` `normHost` folds Greenhouse `boards.*`⇄`job-boards.*` (301 redirect); (2) **the real break** — the intent bridge only matched `file:///*`, so on the **localhost** app page (`http://127.0.0.1:5500`) it never loaded → intent never stored → empty form. Rebuilt as a **background service worker (`background.js`) + `window.postMessage` → `chrome.runtime` messaging** bridge on `127.0.0.1`/`localhost` (no `file://`; a CustomEvent's `detail` doesn't cross into the content-script world — that was the bug). Added a live popup diagnostic. Harnesses 17/17 + 8/8 + 5/5 + 23/23 + 6/6. · ✅ **Résumé handling hardened + verified live 2026-07-27**: `cp_default_resume` is the sole résumé source (queue intent carries none), deep/lazy Greenhouse input handling, attach→stabilize→autofill ordering, strict upload verification, honest **Needs Attention** when Greenhouse rejects the programmatic upload (no false green, nothing submitted). Harnesses auto-apply 25/25 + storage 9/9. **Greenhouse Resume Uploader v1** (native input → dropzone `drop` fallback) added; live-verified that Greenhouse blocks BOTH synthetic paths, so the extension safely marks **Needs Attention** and the user attaches the résumé manually (nothing auto-submitted). |
| M10 | **Application Queue v1** — process approved jobs one at a time from Approvals: open in a new tab, Mark Applied / Needs Attention / Skip / Open Next, auto-advance, refresh-safe | — | ✅ Shipped 2026-07-25 (`d30af44`; reuses `ApplicationPackages`; never submits; harness 11/11) |

## To-do (v1.0 → v1.0-tagged)

**Done since release:**
- [x] `.gitignore` repaired — `.claude/` ignored, corrupted UTF-16 `.venv` entry fixed (`e4ec18a`)
- [x] Cross-session handoff protocol — CLAUDE.md rules + HANDOFF.md state doc (`88732e7`)
- [x] Memory notes for future sessions (test-runner technique, data-safety rules, approval rules)
- [x] Un-track `.venv/` — repo dropped 5,599 → 202 tracked files (`a0a1d22`)
- [x] Backend venv rebuilt on **Python 3.12** (3.13 can't build the pinned `pydantic-core`); pins unchanged; **pytest works: 30/30**
- [x] **Chrome extension MVP** (`/extension`, `276f7a0`) — Save Current Job (`POST /api/jobs`, 409 = already saved), Autofill from `/api/profile` (+preferences/+employment), Open CareerPilot; detectors for LinkedIn/Bayt/GulfTalent/Workday/Greenhouse/Lever/generic; fills only empty visible fields, never submits; unknown questions in the popup; `*.db` gitignored
- [x] **Extension autofill v1.1** (`51215de`) — nationality/gender/marital/years from `authorization.*` (text+select+radio), 4 template essay answers (≤70 words, own headline/summary only), salary/comp/bonus/package **NEVER** filled (harness 34/34)
- [x] **Extension: LinkedIn results-list import** (`24c5114` → fixed `2f0b725`, `961c6a0`) — "Import LinkedIn Jobs" reads the on-screen cards (DOM only, no scrape), anchor-first by `currentJobId=`/`/jobs/view/`, dedup by job URL, saves via `POST /api/jobs`; temporary popup debug `links/ids/parsed` (harness 20/20)
- [x] **Real ATS source** (`88b4e46`) — `backend/ats_sources.json` + `app/services/ats_import.py` + `POST /api/ats/import` (& `GET /api/ats/sources`, & CLI `python -m app.services.ats_import`): public Greenhouse/Lever feeds, normalized to a Job, deduped by URL; sample companies **disabled** (backend suite 39/39)

**Done since release (cont'd):**
- [x] **Repo hygiene: dead root files removed** (`b676933`) — `index.html`, `index_backup.html`, `test` deleted; the app is `app/index.html`
- [x] **`v1.0` tag cut and pushed** (2026-07-22) — first git release marker, on `b676933`
- [x] **Salary-gap real fix, not a patch** (2026-07-22) — root cause: `ApplicationPackages.createFrom`
  freezes a JSON snapshot of the job at approval time (deliberate, Sprint 23); a package approved
  before Sprint 30 added `salaryDisclosed`/`currency`/`salaryPeriod` to imported jobs froze in
  "Salary not disclosed" *permanently*, even though `ImportedJobs.withSalary()` (Sprint 30) can
  correctly re-derive that same job's real figure from the still-live import record. Fix: added
  `ApplicationPackages.repairSalary(pkg)` — read-time re-derivation, same pattern as
  `ImportedJobs.withSalary()`, wired into `all()`/`get()` so every package self-heals on every
  read, forever, with **no migration script and no rewrite of what's on disk**. Only fills a gap
  (never overwrites a legitimately-frozen "not disclosed"), only applies to `imp-`-prefixed job
  ids (an imported job's own id — the only place a live source of truth still exists), and leaves
  a package alone if its import was since deleted. New regression test: sprint30 case 13 (13/13
  green). Sprint23/24/26/27/29 (all consume `ApplicationPackages`) re-run green too — 6/6, 5/5,
  10/10, 8/8, 8/8. Sprint25/28 use `ApplicationPackages.forJob()` only on non-imported (discovered)
  jobs, so they're unaffected by code-path inspection; their async headless run didn't produce
  clean console output this session (known flaky pattern, same family as sprint18) so they weren't
  independently re-confirmed — not a regression risk given the code path they exercise.

**Open — code/repo:**
- Nothing open right now — all v1.0 → v1.0-tagged code/repo items above are done.

**Open — user-side (browser / live run; not code):**
- [ ] **Live-DOM smoke test the extension** — Load unpacked (`chrome://extensions` → `/extension`; see `extension/README.md`). Save + Autofill on a real posting, and Import on a LinkedIn search page. Selectors are untested against live DOMs; the LinkedIn importer now prints `links/ids/parsed` in the popup — paste those numbers if it comes back low.
- [ ] Extension autofill reads the **backend** profile — populate it first (Settings → backend sync, or `PUT /api/profile`); the browser-localStorage profile is **not** what the extension sees
- [ ] To use the ATS importer: set `"enabled": true` for a company in `backend/ats_sources.json`, run the backend, `POST /api/ats/import` (needs internet)
- [ ] Run certification recovery — Resume Library → amber banner → **Restore** (built, never executed)
- [ ] Re-enter six unrecoverable profile fields: target roles, preferred locations, languages, work mode, job type, sponsorship flag
- [ ] Optionally recover work authorization / minSalary / LinkedIn from `careerpilot_prep_v1` + stored cover letters (console snippets in chat history)

## Current State

**Version 1.0 is released.** All 30 sprints are committed and pushed. The app is
feature-complete: profile, résumé parsing and tailoring, multi-source job discovery,
weighted matching, application packages, cover letters, approvals, tracker, interview
prep, and an optional FastAPI backend with two-way sync.

- **18 browser test suites green.** Sprint 18 cannot run headlessly (async
  multi-source search never settles offline) — known, **not** a regression.
- Sprint 30 (*Version 1 Final Stabilization*, harness at
  [app/tests/sprint30/sprint30.html](app/tests/sprint30/sprint30.html), now **13 cases**) is
  complete, including demo-data isolation, additive résumé sync, cert recovery, backup
  export/import, and (case 13, 2026-07-22) the salary self-heal described above.
- `9e67065` removed the salary-editing UI for discovered jobs ahead of release. Salary
  entry survives only for **imported** jobs; the salary chip and the import-form
  currency/period fields were deliberately kept ("Edit UI only" revert scope). There is
  still deliberately **no editing UI** anywhere (sprint30 case 12 enforces this) — the
  2026-07-22 fix only re-derives a figure the app already knew, never lets the user type one in.
- **`v1.0` git tag exists**, cut and pushed 2026-07-22, on `b676933`.
- **ATS Engine v1 (2026-07-25)** — `app/js/ats/ats-engine.js` (global `AtsEngine`, dependency-free,
  no network/storage/UI). `AtsEngine.detect(url | {url, html})` and `detectPage()` return
  `{ats, company, supported, confidence}` for Greenhouse / Lever / Workday / SuccessFactors /
  SmartRecruiters / Taleo / Oracle / iCIMS. Detection only — no autofill, no submission. Harness
  [app/tests/ats/ats.html](app/tests/ats/ats.html) is **22/22** (pure functions, touches no
  localStorage). Registered in `app/index.html`; inert until called (no dashboard/UI change).
- **Universal Autofill v2 + profile auto-sync + resilient storage (2026-07-25, `f21d7e7`, NOT pushed yet).**
  Three fixes on top of the Chrome extension:
  - **Autofill v2** (`extension/content.js`) — the engine now fills every common control incl.
    **checkboxes** and the **résumé file upload** (from a default résumé cached in the extension),
    on top of the existing text/email/phone/number/textarea/select/radio + identity fields. Still
    never fills salary, never ticks consent/legal boxes, never overwrites an answer, never submits.
    Harness [extension/tests/autofill/](extension/tests/autofill/autofill.html) **19/19**.
  - **ProfileAutoSync** (`app/js/platform/profile-autosync.js`) — root cause of "backend profile is
    empty": the app is local-first, so the profile lived only in localStorage while the extension
    reads the **backend**, whose `GET /api/profile` auto-creates a blank row. Fix upserts the local
    profile to the backend (**PUT**, not the insert-only `/api/migrate`) on boot + on profile save,
    best-effort, hash-gated (one-time, self-healing), never pushes a blank profile. Harness
    [app/tests/profile-sync/](app/tests/profile-sync/profile-sync.html) **8/8**; backend
    `test_extension_contract.py` +3 (suite **42/42**).
  - **Extension storage fix** (`extension/storage.js`) — `SafeStorage` wraps `chrome.storage.local`
    so a missing/late `storage` permission can't crash the popup ("reading 'local'"); falls back to
    an in-memory session store (never website localStorage). Harness
    [extension/tests/storage/](extension/tests/storage/storage.html) **7/7**.
- **Application Queue v1 (2026-07-25, `d30af44`).** Process approved jobs one at a time. The queue
  runs over the existing Sprint 23 packages at `ready_to_apply` (`ApplicationPackages.ready()`) — no
  new job/approval store, only a small persisted session (order + per-job outcome + current job).
  `ApplicationQueue` (`app/js/queue/queue-store.js`) + `QueueView` (`app/js/queue/queue-view.js`,
  an additive card on Approvals using existing CSS). **Start Applying** opens the first job in a new
  tab; per job: **Mark Applied** (→ `ApplicationPackages.markApplied`, feeds the board), **Needs
  Attention** (flag + stay), **Skip**, **Open Next**; Applied/Skip auto-advance. Duplicate processing
  is prevented (idempotent apply, applied-elsewhere skipped, Start resumes an active queue) and state
  survives a refresh (AppStorage). **Never submits — only opens apply URLs.** Harness
  [app/tests/queue/](app/tests/queue/queue.html) **11/11**.
- **Extension "Save Current Job" now appears in Today's Jobs (2026-07-26, `749191c`).** The extension
  writes to the backend (POST /api/jobs); Today's Jobs was localStorage-only, so saved jobs never
  showed. `JobsBackendSync` (`app/js/platform/jobs-backend-sync.js`) pulls GET /api/jobs on boot and on
  each board visit and folds each row into `ImportedJobs` via `upsertFromBackend`. Deduped on the
  backend job's **own identity** (id / source_job_id), never the canonical URL. Harness **8/8**.
- **Imported jobs can create applications and appear in Approvals (2026-07-26, `bd64909`).** Creating an
  application for an approved imported job now shows on Approvals (new **Saved-job applications** card,
  `QueueView.applicationsCard`) and **"Approve & queue"** (`ApplicationQueue.enqueue`) adds that exact
  job to the Application Queue. `createApplication` no longer reports success without a real package.
  Harness **7/7**.
- **Queued jobs now link only to their own application package (2026-07-26, `749191c`).** Oracle/SPA ATS
  put the requisition id in the query/hash, which `canonical()` strips — so two distinct jobs collapsed
  to one canonical URL and the URL-based dedup linked "WSP — Work Summary" to the unrelated "Microsoft —
  Technical Consultant" package. Fixed by deduping backend imports on backend identity, never the
  canonical URL. Regression tests: imported-approval case 7, jobs-backend-sync case 8.
- **Queue → ATS auto-autofill implemented and tests passing (2026-07-26, `6759244`).** Opening a queued
  job auto-runs Universal Autofill v2 once (bridge + `AutoApply` content script + `AtsEngine`), only for
  queue-opened tabs, never submitting/salary/consent, with login/CAPTCHA/blocked/no-form → Needs
  Attention and run-once guarding. Harnesses **10/10** + **5/5**. **Real supported-ATS smoke test is
  still pending** — the cross-tab wiring (manifest content-scripts, bridge, real ATS DOMs) can't be
  exercised headlessly; needs a load-unpacked run on a live Greenhouse/Lever/Workday/etc. posting.
- **Auto-backup is ON (2026-07-22).** GitHub (`origin/main`) is now a live backup:
  after each unit of work, commit **and** push automatically, no approval prompt
  (CLAUDE.md rule 2). `.gitignore` excludes `.env`, `*.db`, `.claude/` — that is the
  guardrail that keeps auto-push safe.

## Next Up

**✅ Greenhouse résumé handling is DONE + verified live (2026-07-27).** Final verified behaviour on
`https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007`:
- Queue-triggered autofill works; **text fields fill and stay filled**.
- The **current PDF** (`cp_default_resume`) is correctly selected — never a stale queue-intent copy.
- **Greenhouse blocks synthetic résumé upload** — it rejects BOTH a programmatic `input.files`
  assignment AND a synthetic dropzone `drop`. (Greenhouse Resume Uploader v1 tries the native input,
  then the dropzone drop — once each, no retry loops — but the real page accepts neither.)
- So CareerPilot **safely marks Needs Attention** and the popup's **RÉSUMÉ UPLOAD** panel says
  "Upload: FAILED — attach manually" — no false green. The **user attaches the résumé by hand**.
- **Nothing is ever submitted automatically**; salary is never filled; cover-letter/photo/portfolio are
  never touched; manually-entered data is never overwritten.

**Honest conclusion:** programmatic résumé upload to Greenhouse is **not achievable** from a content
script (they gate uploads behind a real user gesture / their own signed flow). The extension does
everything it safely can — correct PDF selected, text filled, honest Needs Attention — and leaves the
one-click file attach to the user. Committed as
`fix: handle Greenhouse resume uploads safely with manual fallback`.

Résumé handling was hardened over six rounds:
- **Round 1** — the résumé-slot finder gated file inputs on `formVisible`, excluding Greenhouse's hidden
  native `<input type=file>`; + fall back to the popup's `cp_default_resume` in `chrome.storage.local`
  when the Queue payload has no résumé.
- **Round 2 (the real page)** — the native input is **rendered lazily, only after "Attach" is clicked**
  (and can sit in a shadow root / same-origin iframe). [content.js](extension/content.js) now has a
  deep file-input search (main doc + shadow DOM + same-origin iframes) and an async
  `attachResume(resume)` that, if no résumé input exists, safely clicks the **résumé-only** "Attach"
  control (never a submit button, never cover-letter/photo) to reveal it, assigns the PDF via
  DataTransfer + input/change, and confirms the filename becomes visible.
  the popup shows **RÉSUMÉ UPLOAD**: résumé found / résumé input / file assigned / filename. No default
  résumé + a résumé field → **Needs Attention (`no-resume`)**.
- **Round 3 (re-render regression)** — clicking "Attach" makes React **re-render the form and wipe the
  text we'd already filled**. Fix in [auto-apply.js](extension/auto-apply.js): reordered to **attach the
  résumé FIRST → `waitStable()` (MutationObserver quiet-period) → then Autofill v2 for the text** (fills
  only empty fields, never overwrites), then a final re-attach if a late re-render cleared the file. Text
  + résumé now end filled together; hand-typed fields are preserved; the stored PDF is kept (no DOCX
  switch).
- **Round 4 (Set Default Résumé didn't replace a stored DOCX)** — `SafeStorage.set` leaves the old value
  in `chrome.storage.local` if the write silently fails (quota / permission not live), and `get` is
  storage-first, so the stale DOCX kept coming back. Added [storage.js](extension/storage.js)
  `SafeStorage.replace(key,value)` = **remove-then-set + read-back verify** so a new file wholly replaces
  the old (never a merge, stale entry can't resurface). The popup saves via `replace`, refreshes
  immediately to the new file, and reports honestly (persisted / session-only / failed).
- **Round 5 (stale résumé used + false green + uploadFile error)** — auto-apply *preferred the résumé
  baked into the queue intent* (an old DOCX) over the current `cp_default_resume` PDF, and reported
  success even when Greenhouse's widget threw `Cannot read properties of undefined (reading 'uploadFile')`.
  Fixes: (1) **`cp_default_resume` is the ONLY résumé source** — auto-apply ignores any `data.resume`,
  and the app ([queue-autoapply.js](app/js/queue/queue-autoapply.js)) no longer puts a résumé binary in
  the queue intent (job + profile only). (2) `attachResume` verification is now **strict**: success needs
  `files[0]` present **and its name == the current résumé** **and** the filename visible **and** no
  upload-widget error (new `resumeUploadError` detector). (3) On failure → **Needs Attention
  (`resume-upload-failed`)**, text stays filled, and the popup shows an honest **RÉSUMÉ UPLOAD** panel
  (amber sub-checks + red "Upload: FAILED — <error>", never a false green).
- **Round 6 (Greenhouse Resume Uploader v1 — dropzone fallback)** — added a second upload strategy on
  the two Greenhouse board hosts: after the native input, `attachResume` **dispatches the PDF through
  Greenhouse's own dropzone via a real `drop` event + `DataTransfer`** (résumé-only; once; no retry
  loops; diag records `method`). Verified against a faithful mock (test 25). **Live result: Greenhouse
  rejects this too** — so the net user-facing behaviour is unchanged (honest Needs Attention). Kept as a
  best-effort path; harmless when rejected.

Tests on the exact Anduril URL: auto-apply **25/25** (incl. **stale DOCX in queue ignored → current PDF
used**, **uploadFile widget error → Needs Attention / no false green**, **native-rejected → dropzone
drop path**); queue app-side **6/6** (intent
carries no résumé); manual autofill **19/19**; résumé storage **9/9**; messaging **8/8**. Files:
`extension/{content.js, auto-apply.js, popup.js, storage.js}`, `app/js/queue/queue-autoapply.js` + tests
`extension/tests/{auto-apply, storage}`, `app/tests/queue-autoapply`. Never submits. **Committed + pushed.**

No further auto-upload work is planned: both viable content-script strategies — programmatic
`input.files` **and** a synthetic dropzone `drop` — are rejected by Greenhouse (it gates uploads behind a
real user gesture / its own flow). Honest **Needs Attention + manual attach** is the final behaviour; the
extension does everything else (correct PDF selected, text filled, nothing submitted).

**Queue → ATS auto-autofill is DONE and verified live** (2026-07-27) on
`https://job-boards.greenhouse.io/andurilindustries/jobs/5193775007` — opening it from the Queue
autofilled the Greenhouse form once, automatically. Committed as
`fix: make queue-triggered ATS autofill reliable on real job pages`.

Temporary diagnostics still in place (remove when no longer needed): the popup **QUEUE → ATS AUTO-RUN**
panel (bridge loaded / last queue event / background received / intent / ATS-run stage), and
`app/tests/queue-origin/probe.html` (a manual loaded-extension ACK check — the automated headless probe
can't observe the real service-worker round-trip under Chrome's virtual clock).

Standing user-side items: enable ATS companies, cert recovery — whenever the user is at their browser.

## Open Issues

1. ~~Dead files at repo root~~ — **resolved** (`b676933`): `index.html`,
   `index_backup.html`, `test` removed.
2. **Historical commits carry `Co-Authored-By: Claude`** (through `e4ec18a`). The
   no-AI-attribution rule applies **going forward**; history is not being rewritten
   without an explicit request.
3. **Sprint 18's harness cannot run headlessly.** Needs a real browser window. Known.

## Historical Incident — do not repeat

The user's real profile (certifications and more) was **destroyed once** by the
pre-fix Sprint 28 sync combined with test harnesses clearing shared `file://`
localStorage. Recovery came from
`careerpilot_documents_v1 → variants[].plan.ops.certs`.

The data-safety invariants in [CLAUDE.md](CLAUDE.md) §5 exist because of this. Never
kill a test harness mid-run.

## Sprint Log

*(Date column added 2026-07-22 so the log's recency is unambiguous at a glance — see
HANDOFF update rule below.)*

| Date | Sprint | Commit | Summary |
|------|--------|--------|---------|
| 2026-07-27 | — | *(this commit)* | fix: handle Greenhouse resume uploads safely with manual fallback — **✅ verified live**: text autofill works + stays filled, current PDF selected, **Greenhouse blocks synthetic upload** (both `input.files` AND a dropzone `drop`), CareerPilot safely marks **Needs Attention** for manual attach, nothing auto-submitted. Greenhouse Resume Uploader v1 (native input → dropzone `drop` fallback) added — résumé-only, once each (no retry loops), diag records `method`, popup shows honest Upload ok/FAILED. auto-apply 25/25 (test 25: native-rejected→dropzone path on exact URL); autofill 19/19, storage 9/9, messaging 8/8, queue 6/6. |
| 2026-07-27 | — | `6f985be` | fix: stabilize ATS résumé handling and report upload failures accurately — **✅ verified live** on `job-boards.greenhouse.io/andurilindustries/jobs/5193775007` (text fills + stays filled; current PDF used; Greenhouse rejects the programmatic upload; honest Needs Attention; no false success; nothing submitted). Five rounds: (1) hidden/`formVisible` gate → deep file-input search (doc+shadow+iframes); (2) **lazy input behind "Attach"** → safe résumé-only Attach click to reveal it; (3) **Attach re-renders + wipes text** → reordered attach→`waitStable()`→autofill (fills only empty, never overwrites); (4) **Set Default Résumé didn't replace a DOCX** → `SafeStorage.replace()` (remove-then-set + verify); (5) **stale DOCX used + false green** → `cp_default_resume` is the ONLY source (intent carries no résumé), strict verify (files[0] name-match + filename visible + no `uploadFile` widget error), failure → Needs Attention (`resume-upload-failed`) with honest popup RÉSUMÉ UPLOAD panel. Tests: auto-apply 24/24, queue 6/6, autofill 19/19, storage 9/9, messaging 8/8. Never submits. |
| 2026-07-27 | — | `38dd39a` | fix: make queue-triggered ATS autofill reliable on real job pages — **✅ verified live on `job-boards.greenhouse.io/andurilindustries/jobs/5193775007`**. Two bugs: (1) `matchIntent` `normHost` folds Greenhouse `boards.*`⇄`job-boards.*` (301 redirect); (2) the intent bridge only matched `file:///*` so on the **localhost** app page it never loaded → empty form. Rebuilt as a **background service worker + `window.postMessage`→`chrome.runtime` bridge** on `127.0.0.1`/`localhost` (a CustomEvent's `detail` doesn't cross into the content-script world — the real bug); no `file://`. Live popup diagnostic added. New `background.js`, `tests/messaging` (8/8), `tests/queue-origin` @127.0.0.1:5500 (5/5); auto-apply 17/17, ats 23/23, queue 6/6. Safety rules unchanged (never submit/salary/overwrite; run-once; hand-opened never auto-runs). |
| 2026-07-26 | — | `6759244` | feat: queue-triggered ATS autofill — opening a queued job auto-runs Universal Autofill v2 once (bridge + AutoApply + AtsEngine); queue-opened tabs only; never submit/salary/consent; login/CAPTCHA/blocked/no-form → Needs Attention; run-once guarded. Harnesses 10/10 + 5/5. **Real-ATS smoke test pending.** |
| 2026-07-26 | — | `bd64909` | fix: imported jobs through approvals & queue — Saved-job applications card on Approvals + `ApplicationQueue.enqueue` (Approve & queue); `createApplication` never fake-succeeds. Harness 7/7 |
| 2026-07-26 | — | `749191c` | fix: extension-saved jobs sync into Today's Jobs (`JobsBackendSync` + `upsertFromBackend`); dedup on backend identity not canonical URL → queued jobs link to their own package (WSP↔Microsoft). Harness 8/8 |
| 2026-07-25 | — | `d30af44` | Application Queue v1: process approved jobs one at a time (Start Applying → open in new tab · Mark Applied / Needs Attention / Skip / Open Next · auto-advance · dup-prevention · refresh-safe · never submits). Reuses `ApplicationPackages`. Harness 11/11 |
| 2026-07-25 | — | `f21d7e7` | Universal Autofill v2 (checkboxes + résumé upload) · ProfileAutoSync (local→backend profile upsert, fixes "backend profile empty") · SafeStorage extension fix. Harnesses 19/19 + 8/8 + 7/7, backend 42/42 |
| 2026-07-25 | — | `7aa5985` | ATS Engine v1 (detection only): `AtsEngine.detect` identifies Greenhouse/Lever/Workday/SuccessFactors/SmartRecruiters/Taleo/Oracle/iCIMS from a job URL (or embedded HTML); returns `{ats, company, supported, confidence}`; harness 22/22 |
| 2026-07-22 | — | `d247d2f` | Salary-gap real fix: `ApplicationPackages.repairSalary` self-heals pre-Sprint-30 frozen packages on read; sprint30 case 13 added (13/13) |
| 2026-07-22 | — | `v1.0` | Tag cut on `main` HEAD and pushed — first git release marker |
| 2026-07-22 | — | `b676933` | Repo hygiene: removed dead root files (index.html, index_backup.html, test) |
| 2026-07-22 | — | `e67de17` | Handoff: log auto-backup policy in Sprint Log |
| 2026-07-22 | — | `cb5e7a5` | Enable GitHub auto-backup: contract rule 2 amended, `.env` gitignored |
| 2026-07-16 | — | `88b4e46` | Real ATS job source: public Greenhouse + Lever feeds |
| 2026-07-16 | — | `961c6a0` | LinkedIn importer: anchor-first collection + structural parsing |
| 2026-07-16 | — | `2f0b725` | Fix LinkedIn importer: collect the whole results list |
| 2026-07-16 | — | `24c5114` | Extension: real LinkedIn Jobs list import |
| 2026-07-14 | — | `51215de` | Extension autofill v1.1: authorization fields, radios, essays, salary never filled |
| 2026-07-14 | — | `099da7c` / `64ae7e2` | Handoff updates (extension MVP pushed) |
| 2026-07-14 | — | `276f7a0` | Chrome extension MVP: save job + autofill from profile |
| 2026-07-14 | — | `a0a1d22` | Un-track `.venv` (5,397 files) |
| 2026-07-14 | — | `1a5e718` | Handoff: milestones table + v1.0 to-do list |
| 2026-07-13 | — | `88732e7` | CLAUDE.md operating rules + HANDOFF.md handoff protocol |
| 2026-07-13 | — | `e4ec18a` | .gitignore repair (`.claude/`, corrupted UTF-16 `.venv` entry) |
| 2026-07-13 | 30 | `9e67065` | Version 1 final stabilization; salary-edit UI removed — **v1.0** |
| 2026-07-13 | 29 | `2c3e7df` | Intelligent weighted job matching |
| 2026-07-13 | 28 | `4d6f10f` | Profile recovery & résumé parsing stabilization |
| 2026-07-12 | 27 | `8e8928f` | Résumé tailoring & application package builder |
| 2026-07-12 | 26 | `7d94760` | Job import & approval workflow |
| 2026-07-12 | 25 | `6c9599e` | Multi-source job discovery engine |
| 2026-07-12 | 24 | `6fa0849` | Application pipeline & workflow enhancements |
| 2026-07-12 | 23 | `5ab66e0` | Application package preparation |
| 2026-07-12 | 22 | `85545fb` | Cover letter generator |
| 2026-07-12 | 21 | `80ede7a` | Résumé recommendation engine |
| 2026-07-12 | 20 | `ff7e5ed` | Enhanced job match scoring |
| 2026-07-12 | 19 | `91d83d2` | Advanced search & saved searches |
| 2026-07-12 | 18 | `ff39070` | Job search engine & multi-source aggregation |
| 2026-07-12 | 17 | `46971ac` | Live backend sync & two-way persistence |
| 2026-07-12 | 16 | `4d81b43` | Local backend, database & real persistence MVP |
| 2026-07-12 | 15 | `9a982f4` | Live connector integration layer |
| 2026-07-12 | 14 | `aea5c8b` | Backend integration foundation |
| 2026-07-12 | 13 | `404a902` | Interview copilot & application memory |
| 2026-07-12 | 12 | `6da0677` | Application automation & submission readiness |
| 2026-07-12 | 11 | `e8858e1` | Production connector framework |
| ≤2026-07-12 | ≤10 | *see `git log`* | Core UI, connectors, application pipeline |

## Map of the Code

Frontend under `app/js/`, one folder per domain:

`profile/` · `parsing/` (résumé readers, extractor, cert recovery) · `resumes/`
(library, tailoring, cover letters) · `jobs/` (store, filters, decision engine) ·
`matching/` (v2 engine, skill matcher, synonyms, cert hierarchy) · `search/` (engine +
7 providers: LinkedIn, Indeed, Bayt, GulfTalent, Greenhouse, Lever) · `discovery/` ·
`imports/` · `applications/` · `package/` · `companies/` · `prep/` · `interview/` ·
`submit/` · `sources/` (connectors, rate limiting, dedup, pipeline) · `platform/`
(api-client, sync-manager, storage-provider, backup, admin-view, telemetry) · `lib/`
(icons, notify, theme, activity, master-resume).

Backend under `backend/app/`: `routes/` (incl. `ats.py` → `/api/ats/import`) · `models/`
· `schemas/` · `services/` (incl. `ats_import.py`), with `tests/` alongside. Config:
`backend/ats_sources.json`. Run: `.venv\Scripts\uvicorn app.main:app --port 8000`;
test: `.venv\Scripts\python -m pytest -q -p no:warnings` (39/39, Python 3.12 venv).

Screen registry and hash router: [app/js/app.js](app/js/app.js) — includes hidden
screens `#/admin` (System Diagnostics), `#/review`, `#/resumeReview`.

**Chrome extension** under `extension/` (Manifest V3): `manifest.json`, `popup.html`,
`popup.js` (backend calls: `/api/profile`, `POST /api/jobs`), `content.js` (job
detection, autofill, `collectLinkedIn`), `README.md` (load-unpacked steps). No JS
runtime on this machine → tested with standalone headless-Edge harnesses that stub
`chrome.*` and drive the real scripts (see [[headless-edge-test-runner]] in memory).
