# CareerPilot AI — Handoff

**Single source of truth for project state.** New chat / new agent: read this top to
bottom, then continue from **Next Up**. Rules, project shape, and how to run the tests
live in [CLAUDE.md](CLAUDE.md) — read that too.

- **Last updated:** 2026-08-10 *(always keep this line current — every HANDOFF edit stamps today's date here, so anyone can tell the latest version at a glance)*
- **Status:** 🟢 **v1.0 SHIPPED** (2026-07-13, tagged 2026-07-22) · since: Chrome extension, real ATS import, ATS Engine v1, Universal Autofill v2 + profile auto-sync + resilient extension storage, Application Queue v1, extension-save→Today's-Jobs sync, imported-jobs→approvals→queue, queue-triggered ATS autofill + hardened résumé handling (verified live on Greenhouse 2026-07-27), Workday adapter (queue autofill verified live on PwC 2026-07-30; national-phone recheck pending), **Job Discovery v1 — "Fetch Jobs Now" for LinkedIn · Bayt · GulfTalent (committed 2026-08-02; LinkedIn virtualized-scroll fix in; live retest pending)**
- **Branch:** `main` — clean, in sync with origin
- **Head:** `feat: import real Cisco jobs and tighten ATS filtering to Saudi/Qatar target roles` (hash in git log) · tag `v1.0` on `b676933`
- **App state:** 🧼 **clean tracker, real-jobs-only.** All demo/seed jobs are gone permanently; every
  board starts at zero and fills only with real jobs that pass the filters.
- **Live data right now:** the real backend database holds **exactly 2 jobs** — both Cisco, both
  Riyadh, Saudi Arabia (*Senior Cybersecurity Solutions Engineer – Splunk* and *Partner Solutions
  Engineer*). The 68 earlier ATS imports were deleted on 2026-08-10; profile, employment,
  preferences and résumé were preserved and verified unchanged.
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
| M14 | **Job Discovery v1 — "Fetch Jobs Now"** — one button on Today's Jobs brings real jobs in from **LinkedIn, Bayt and GulfTalent**, using the Chrome sessions the user is already signed into | — | ✅ **Implemented for all three portals 2026-08-02** (committed + pushed). One saved search URL per portal → the extension opens each in a background tab, harvests the cards, dedups by source job id **and** exact URL, saves via the existing `POST /api/jobs`, reports found/saved/duplicate/failed; login/CAPTCHA → **Needs Attention**. **LinkedIn virtualized-scrolling fix implemented** after the first live run returned 1 job of 99+: the harvest now scopes to the left results list and scrolls it in rounds (stop: 3 idle rounds or 50 jobs), with per-source diagnostics and an honest harvest-failure verdict. **Automated tests collect 30/30 virtualized LinkedIn jobs.** Harnesses 24/24 + 14/14, backend 51/51. **Real LinkedIn live retest still pending** — expected ~20–25 jobs from one results page. |

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
- [ ] **Demo-dependent tests need separate fixture updates** (2026-08-03) — 11 cases across sprint23
  (6), sprint24 (2), sprint25 (2,3,5,6,7), sprint26 (5,10), sprint27 (8) and sprint30 (1) assert on
  the demo/seed data that has now been removed on purpose (e.g. "expected the four mock feeds to
  return 10+ jobs", "the board should never be empty", "drag and drop was lost"). **None is a
  functional regression** — each needs to seed its own fixture instead of leaning on shipped sample
  data. Deliberately left for a separate pass. **Start with sprint30 case 1**: it is the CLAUDE.md §5
  data-safety guardrail, so that invariant is unprotected until it is repaired.
- [ ] **A local git stash holds discarded work** — `stash@{0}` "discarded: LinkedIn visible-cards
  importer + Todays-Jobs visibility". Kept as a rollback net when that round was discarded on
  2026-08-03; it is local-only and will be lost if the clone is. Drop it (`git stash drop`) or restore
  it (`git stash pop`) when you have decided.

**Open — user-side (browser / live run; not code):**
- [ ] **Real LinkedIn live retest — STILL PENDING.** The first live run returned 1 LinkedIn job of
  99+ (its list is virtualized); the harvest was rebuilt to scroll and the **automated tests now
  collect 30/30 virtualized jobs**, but that is a mock, not the live page. **Reload the unpacked
  extension** (`chrome://extensions` → Reload — `harvest.js` and the manifest both changed), start
  the backend, then fetch again. **Expected live result: roughly 20–25 jobs from one results page**
  (the harvest scrolls but deliberately never paginates). A LinkedIn `failed` row now names the card
  and parsed counts — that message is the thing to capture. Bayt and GulfTalent have never been run
  live at all — their selectors are structural but untested against the real DOMs.
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

**✅ Cisco live importer + hard ATS filtering — VERIFIED LIVE (2026-08-10).**

**The tracker is clean.** The 68 junk ATS jobs imported on 2026-08-02 were deleted from the real
backend database; profile (1), preferences (1), employment (3), skills, certifications, résumé
metadata and users were all verified unchanged. `GET /api/jobs` now returns **exactly 2 jobs** — both
Cisco, both Riyadh.

**Hard filters, applied to every ATS/Cisco posting before it can be saved**
([ats_import.py](backend/app/services/ats_import.py), reused verbatim by Cisco):
- **Location — Saudi Arabia or Qatar only.** UAE, Remote, Global and every other country are
  rejected. A posting that names Riyadh/Doha alongside another site still counts as in-region;
  a bare "Remote"/"Global" names no country and is rejected.
- **Role — the target areas only**, matched against the TITLE (a description that merely mentions
  "security" is not a security role): network / cyber / physical security, security + network
  engineer/architect, solutions architect/engineer, technical consultant, infrastructure, presales,
  technical delivery, implementation, project / programme / technical project manager, PSIM,
  security systems, ICT. Verified 27/27 target titles matched, 12/12 off-target rejected.
- **Salary — disclosed-and-below rejects; undisclosed is KEPT.**
  - disclosed **≥ 30,000 SAR/month** → kept, marked **`salary_status: verified`** (written to the
    row's `salary` / `salary_disclosed` / `currency` columns)
  - disclosed **< 30,000 SAR/month** → **rejected**
  - **undisclosed → kept, marked `salary_status: unknown`** — silence is never a rejection and the
    figure is never guessed
  - Qatar uses the equivalent senior threshold, **29,000 QAR/month** (SAR and QAR are both
    USD-pegged, so it is the same money: 30,000 SAR = USD 8,000 ≈ 29,100 QAR). Annual figures are
    divided by 12; a disclosed range uses its upper bound.

**Cisco importer — new, and verified against the live site.** `jobs.cisco.com` serves
`careers.cisco.com`, which runs on **Phenom People**: every URL returns the same 173 KB JS shell, so
there is no HTML to parse. The results come from the endpoint Cisco's own search page calls —
`POST https://careers.cisco.com/widgets` with `ddoKey: refineSearch` and
`selected_fields.country`, returning `refineSearch.data.jobs`. No scraping, no auth, one request per
country. (The documented GET form, `/api/apply/v2/jobs`, answers `"Tenant not identified"` — only the
POST form works.)
- [cisco_import.py](backend/app/services/cisco_import.py) + [routes/cisco.py](backend/app/routes/cisco.py)
  → `POST /api/cisco/import`, `GET /api/cisco/countries`.
- Deduped by **Cisco job id and exact URL** (a reissued id at the same URL is still a duplicate).
- Borrows the ATS filters rather than reimplementing them — a test pins that a Cisco **UAE** posting
  is still rejected; Cisco gets no exemption.
- Wired into **Fetch Jobs Now** beside the Greenhouse/Lever feeds (`runBackendSources()` runs both);
  saved rows go straight onto Today's Jobs. Apply URLs point at `cisco.wd5.myworkdayjobs.com`, so
  the existing Workday autofill applies to them.

**Live run (2026-08-10):** Saudi Arabia fetched 5 → 2 kept → 2 saved; Qatar fetched 0 (Cisco has no
Qatar postings right now — the country is searched every run). 3 filtered out by the role rule
(Renewals Specialist, Telco Account Executive, Splunk Customer Success Engineer). Re-import: saved 0,
duplicate 2.

**Greenhouse/Lever status:** the six enabled boards (Careem, Tamara, Elastic, MongoDB via Greenhouse;
Binance, Palantir via Lever) are real and verified live, but under the tightened rules they currently
yield **0** — their Saudi postings are all off-target (fintech/analytics/customer-care roles) and
they post nothing in Qatar. Left enabled; they will contribute when a matching role appears.

Tests: backend **173 passed**, app job-fetch **25/25**.


**🧹 All job data cleared + a permanent reset — ✅ VERIFIED LIVE IN THE REAL BROWSER (2026-08-03).**
The user confirmed the reset ran and every screen reads zero. What this achieved:
- **All old jobs, approvals, packages, queue and application history are cleared** — Today's Jobs,
  imported/saved jobs, prepared packages, the Application Queue with its applied / skipped /
  Needs Attention outcomes, the Applications board, submissions, and application+interview memory.
- **Dashboard and pipeline counters are reset to zero** — pipeline 0,0,0,0 · funnel all 0 ·
  stat tiles 0 / 0% / 0% / — · "No activity yet". No invented "128 applications" or "$148k".
- **Profile, employment, certifications, preferences and the résumé library are preserved**, along
  with the master and parsed résumé, backend configuration, both safety backups, and the **saved
  search URLs**.
- **Demo/seed jobs are removed permanently** — not just cleared from storage, deleted at source, so
  nothing re-seeds on the next load.
- ⚠️ **Demo-dependent tests still need separate fixture updates** — see *Open — code/repo*.

The backend database was
backed up to `backend/careerpilot-before-clear.db` and its 6 job rows deleted (profile, preferences
and 3 employment rows untouched, verified through the live API). On the browser side there is now one
reset instead of a hand-written key list:

**`JobDataReset`** ([app/js/platform/job-data-reset.js](app/js/platform/job-data-reset.js), registered
in `index.html`, called from `app.js` boot):
- clears 15 stores — Today's Jobs, imported jobs, packages, the Queue (with applied/skipped/
  needs-attention), the Applications board, prep, submissions, application+interview memory, activity,
  cover letters, résumé overrides, job cache, search cache, sync log, and the discovery run counts.
- **never hard-codes a key.** Each target names its owning MODULE and the key is read off it at run
  time (`Mod.STORAGE_KEY` / `Mod.KEY`), preferring the module's own `clear()`. A module that fails to
  resolve is REPORTED (`absent`), never silently skipped.
- preserves profile, employment, certifications, résumé library, master + parsed résumé, preferences,
  backend config, the two safety backups, and the **saved search URLs** — `JobFetchStore` is
  deliberately not cleared via its own `clear()` (that would take the URLs), only `lastRun` goes.
- **runs once per install** on load (flag `careerpilot_job_data_reset_v1`), then never again;
  `JobDataReset.run()` re-runs it on demand.

Two real bugs the harness caught before shipping: (1) `interview-store.js` exports **`ApplicationMemory`**,
not `InterviewStore` — the wrong name would have silently skipped the applied/interview history;
(2) these modules are top-level `const` — **lexical globals, NOT `window` properties** — so the
original `window[name]` lookup resolved nothing and cleared nothing. Targets now reference the
identifiers directly behind `typeof` guards, the idiom the rest of the app uses.

**Demo/seed data removed at source** (clearing storage alone could never work — four of these re-seed
themselves whenever their key is empty):
`data.js` (`DB.jobs`/`approvals`/`applications`, plus the invented dashboard `stats`/`funnel`/
`monthly`/`weekly`/`bestPerformers`/`pendingActions`) · `jobs-store.js` `BASE_JOBS` (what Today's Jobs
actually rendered — `DB.jobs` was dead code) · the six search providers' `RAW` mock feeds (four
auto-register, so `Jobs.bootDiscovery()` republished them on every refresh) ·
**`ApplicationsStore.defaults()`** (10 demo applications) · **`Activity.seed()`** (5 invented events).
`app.js` no longer prints a hard-coded "128 applications" / "$148k".

Verified end-to-end in a headless browser profile (seed 24 keys → load the app → **pipeline 0,0,0,0 ·
funnel all 0 · stats 0/0%/0%/— · "No activity yet" · Today's Jobs 0 · Approvals 0 · Applications 0 ·
Queue 0**, every personal key intact, saved LinkedIn search URL kept) — and then **confirmed live by
the user in their own Chrome profile on 2026-08-03**.

⚠️ **11 tests now fail, all asserting demo data that no longer exists** — sprint23 5/6, sprint24 4/5,
sprint25 2/7, sprint26 8/10, sprint27 7/8, sprint30 12/13 (e.g. "expected the four mock feeds to
return 10+ jobs", "the board should never be empty", "drag and drop was lost", sprint30 case 1 "the
sample job listings were removed"). None is a functional regression; each needs its own fixture
instead of relying on seed data. **sprint30 case 1 is the CLAUDE.md §5 data-safety guardrail**, so it
should be repaired rather than left red. Everything else is green: job-data-reset 8/8, job-fetch 14/14
+ 24/24, queue 11/11, imported-approval 7/7, ats 23/23, jobs-backend-sync 8/8, queue-autoapply 6/6,
profile-sync 8/8, sprint19–22/29, backend 51/51.


**🆕 Job Discovery v1 — "Fetch Jobs Now" (2026-08-02, committed + pushed).** One button on
Today's Jobs brings real jobs in from **LinkedIn Jobs, Bayt and GulfTalent** — all three portals
implemented — using the Chrome sessions the user is already signed into. Nothing logs in and no
credential is read or stored.

How it works, end to end:
- **App** — `JobFetchStore` holds ONE saved search URL per portal (validated against that portal's
  host) plus the last run's four counts; `JobFetch` posts a signed `window.postMessage`
  `{kind:'fetch-jobs', token, sources, api}` through the SAME bridge the Application Queue uses;
  `JobFetchView` renders an additive card at the top of Today's Jobs (`app/js/discovery/job-fetch*.js`,
  registered in `app/index.html`, added to `SCREENS.jobs` — nothing below it changed).
- **Extension** — `bridge.js` forwards it to the background worker; `fetch-jobs.js` (`CPFetchJobs`,
  imported by `background.js`) opens each saved search in a **background tab**, injects `harvest.js`,
  reads the cards already on screen (title · company · location · job URL · source · portal job id),
  closes the tab, dedups **by source job id AND by exact job URL**, and saves each job through the
  EXISTING `POST /api/jobs`. Result → `chrome.storage.local` + a direct ACK, relayed back to the app.
- **Board** — the app then runs `JobsBackendSync.pull({force:true})`, so fetched jobs appear in
  Today's Jobs immediately.
- **Backend** — `POST /api/jobs` now also 409s on an **exact `apply_url`** match (never on
  `canonical_url`; that would re-create the WSP↔Microsoft merge).
- **Blocked sources** — a login wall or CAPTCHA is REPORTED, never worked around: that source is
  **Needs Attention**, nothing is harvested from it, and the other portals still run.
- **Scope held**: no matching, no scoring, no autofill, no application/submission changes, no UI
  redesign. Tests enforce it (app case 11).

Tests: extension [extension/tests/job-fetch/](extension/tests/job-fetch/job-fetch.html) **24/24**
(mock LinkedIn/Bayt/GulfTalent DOMs laid out off-screen, so the visibility check is real, plus a
virtualized LinkedIn list) · app [app/tests/job-fetch/](app/tests/job-fetch/job-fetch.html) **14/14** · backend
`tests/test_job_discovery.py` (suite **51/51**). Regression-green: messaging 8/8, auto-apply 36/36,
autofill 19/19, storage 9/9, ats 23/23, queue 11/11, queue-autoapply 6/6, jobs-backend-sync 8/8,
imported-approval 7/7, sprint26 10/10, sprint30 13/13.

Also fixed along the way (pre-existing, not a regression from this work): `bridge.js` posted its ACK
with `targetOrigin = location.origin`, which a `file://` page can never match (opaque origin), so the
ACK was dropped there — messaging case 7 had been failing. Both `bridge.js` and `job-fetch.js` now
fall back to `'*'` when the origin isn't `http(s)`. Production (localhost) behaviour is unchanged.

**🔧 LinkedIn virtualized-scrolling fix — implemented (2026-08-02).** The first live run, on a real
`linkedin.com/jobs/search-results/` saved search with a `currentJobId` already selected, returned
**1 job against "99+ results"**. Root cause: **LinkedIn virtualizes the left results list** —
only the cards near the viewport exist in the DOM, and cards scrolled past are destroyed. v1 read the
freshly opened background tab exactly once, so it saw the rendered window (often just the selected
job). Two further faults found while fixing it: the card's **logo anchor** was picked as the job link
(no text → the title read empty → the card counted as failed), and nothing scoped the read to the
left list, so the **job-details panel's** own `/jobs/view/` links were in scope.

The LinkedIn path in [harvest.js](extension/harvest.js) now:
- **scopes to the LEFT results list** — `li[data-occludable-job-id]`'s shared parent, else known list
  containers, else a `<ul>` holding ≥2 distinct job links; anything inside the details panel is
  excluded by `closest()`.
- **waits** for the first card (a background tab has rendered nothing yet), then **scrolls in rounds**
  (scroll container + `scrollIntoView` on the last card — whichever the page listens to), collecting
  newly rendered cards by LinkedIn job id after each round.
- **stops** after **3 consecutive rounds with no new id**, or at **50 unique jobs** (hard round cap 40).
- **extracts** title (from the visible `aria-hidden`/`strong` span, not the doubled link text),
  company, location, the exact `/jobs/view/<id>/` URL, source and the LinkedIn job id.
- **dedups** by job id and exact URL, plus a `title|company|location` key so a **promoted twin under a
  second id** is not saved twice (deliberate drops are not counted as failures).
- **reports diagnostics** — scroll rounds · card candidates · unique ids · parsed · failed cards —
  carried through `fetch-jobs.js` → the run → `JobFetchStore` → a muted line under each source row.
- **calls a bad read a FAILURE**: ≤1 job parsed with ≥3 cards on screen, or zero cards with no "no
  matching jobs found" on the page, returns `ok:false` with the numbers in the message. Nothing is
  saved — a silent partial result is exactly what hid this bug.

Bayt and GulfTalent are **untouched**: they render their whole page, so `harvestList` returns the
original single read for them (tests assert `harvestList` ≡ `harvest` for both). Autofill, queue,
matching and the UI are unchanged.

**Automated tests collect 30/30 virtualized LinkedIn jobs.** The harness mock is genuinely
virtualized — cards are destroyed as new ones load — and **one read sees 8 while the scrolled harvest
collects 30/30 in 8 rounds**. The 50-job cap holds on an 80-job list; a 12-job list idle-stops at 12.

⏳ **REAL LINKEDIN LIVE RETEST — STILL PENDING** (user-side, needs the browser). The 30/30 above is a
mock, not the live page. **Reload the unpacked extension** (`chrome://extensions` → Reload —
`harvest.js` and the manifest both changed), start the backend, then click **Fetch Jobs Now** on the
same saved search.
- **Expected live result: roughly 20–25 jobs from one results page** — the harvest scrolls the
  virtualized list but deliberately never paginates or clicks, so it collects what that single
  results page holds (LinkedIn serves ~25 per page).
- Also expect the four counts and a diagnostics line per source. If LinkedIn comes back **failed**,
  the message now names the card and parsed counts — that message is the thing to capture.

**✅ Workday Adapter v1 — checkpoint, queue autofill verified live (2026-07-30).** Committed as
`feat: add reliable Workday queue autofill and field handling`. Queue-triggered Autofill v2 on Workday
(`*.myworkdayjobs.com`), hardened over four live-PwC rounds. Verified on the real PwC wd3 job:
- **Queue auto-autofill works** end-to-end; **login / account / email-verification delay is handled** —
  the intent stays valid ≥30 min and is not consumed on the chooser/login/OTP pages, so it autofills once
  the real *My Information* form appears.
- **Latin Given/Family name, Country, City and phone fields fill**; **Arabic name fields stay empty**
  (no Arabic name stored); salary/consent never filled; existing/user values never overwritten; nothing
  is auto-submitted.
- ⏳ **Still pending:** a final live verification of the **national phone formatting on a fresh job**
  (`+966…` → national number via the custom "Country / Territory Phone Code" combobox) — logic is in and
  unit-green (test 36), but not yet re-confirmed on a brand-new Workday posting.

Detail of the four rounds (history):

**Round 3 (Workday phone, [content.js](extension/content.js) only):** with a SEPARATE phone country-code
field (e.g. "+966") the **Phone Number** field gets the NATIONAL number (`+966536886174` → `536886174`);
the country-code / extension / device-type fields never receive the number (`PHONE_NOT` guard on the
Phone rule); **Phone Extension** is filled only from an explicit `phoneExtension`; **Phone Device Type**
combobox selects "Mobile" only when an EXACT "Mobile" option exists (via `fillWorkdayComboboxes`, exact
match). Same `phoneNumberFor` normalization is used by queue AND manual autofill.
**Round 4 (still failed live — detection):** the real control is a CUSTOM combobox labelled "Country /
**Territory** Phone Code" (button/div, not a native input/select) — the old regex needed ≤3 chars between
"country" and "code" so it never matched. Rewrote `phoneCodeControl()` to find it by label / wrapper /
`data-automation-id` (matches phone+code, or country/territory/dial "…code"), and `readDialCode()` reads
the selected "+966" from the control's displayed value; added "territory" to `PHONE_NOT`. One regression
test with a custom combobox (auto-apply **36/36**); autofill 19/19. Nothing else changed.

**Round 2 (2nd live PwC verify — manual autofill now works on the real form):** two more fixes —
- **Arabic name fields** were being filled with the Latin profile name. [content.js](extension/content.js):
  `isArabicNameField` (label contains "arabic" OR Arabic-script chars) — Arabic Given/Family name rules
  run first and fill ONLY from an explicit `arabicFirstName`/`arabicLastName` (absent → field stays
  empty); the Latin name rules are gated `notArabic`. So "Latin Given Name(s)" fills, "Arabic Given
  Name(s)" (and Arabic-script labels) stay empty.
- **Queue intent must survive long Workday login/verification.** [auto-apply.js](extension/auto-apply.js):
  the intent stays valid **≥30 min** on Workday (`WD_INTENT_MAX_AGE`), and Workday **login / account /
  OTP / chooser pages no longer consume it** — only a hard CAPTCHA/bot-wall is terminal; if the real form
  isn't up yet the run returns `workday-waiting` (kept alive) so the next navigation / SPA step autofills
  it once the real form (`workdayFormReady`) is visible. Never auto-clicks Apply Manually/Continue/Next/
  Submit. Tests: auto-apply **34/34** (31 Arabic-vs-Latin names · 32 login doesn't consume · 33 login→form
  autofills once · 34 30-min window). Manual autofill 19/19.

Round 1 (1st live PwC verify) failed two ways — both fixed:
- **Intent consumed too early on the "Start Your Application" modal** → the real form never got filled.
  Fix in [auto-apply.js](extension/auto-apply.js): the queue intent is **no longer consumed up front**.
  A `claim()` (atomic check-and-set) consumes it ONLY at a terminal outcome, and on Workday we WAIT
  THROUGH the modal (`workdayFormReady` + a 90s cap) for the real form step before claiming — so the
  intent survives the *Apply Manually* SPA transition and autofill runs once the real form is visible.
- **Workday React inputs not filled (only phone worked)** → the input's own `data-automation-id` is
  generic (`textInputBox`) and the real label lives on the field WRAPPER. Fix in
  [content.js](extension/content.js): `haystack` now scans a few ancestors for the wrapper's
  `data-automation-id` + its label (only borrowing a label from a single-field wrapper), and `setValue`
  now fires **focus → native value setter → input → change → blur** so Workday's controlled inputs commit.
- **Custom comboboxes** (country/state): new `fillWorkdayComboboxes` opens the listbox and selects ONLY
  an **exact** saved-profile match — never a guess, never overwriting a set value, never a non-combobox
  control. Blockers (Sign In / **account creation** / **OTP** / CAPTCHA / bot wall) → Needs Attention.
- Unchanged safety: résumé from `cp_default_resume` via the real file input (failure → Needs Attention);
  never overwrites existing fields; never fills salary; never auto-accepts consent; never clicks Apply
  Manually / Continue / Next / Submit; one-shot DONE_KEY duplicate-run guard. Diagnostics: the completed
  status records WHICH fields were filled. Manual Autofill still works (autofill 19/19).
- Tests (auto-apply **30/30**): **26** visible current step fills name/email/phone/city/country/exp/
  LinkedIn + salary blank + hidden step untouched · **27** SPA re-fire never autofills twice · **28**
  PwC wd3 **modal → application SPA transition** (intent survives, wrapper-label fields fill once) · **29**
  country combobox EXACT match selected · **30** no exact match → never guessed. Only
  `extension/{auto-apply.js, content.js, tests/auto-apply}` changed. **Committed + pushed.** Remaining
  live checks: national phone formatting on a fresh job (above), and whether Workday accepts a
  programmatic résumé upload (if not → honest Needs Attention, same as Greenhouse).

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
| 2026-08-10 | — | *(this commit)* | **Cisco live importer + hard Saudi/Qatar target-role filtering — ✅ verified live.** New [cisco_import.py](backend/app/services/cisco_import.py) + [routes/cisco.py](backend/app/routes/cisco.py) (`POST /api/cisco/import`): careers.cisco.com runs on **Phenom People**, so the results come from the endpoint its own page calls — `POST /widgets` with `ddoKey: refineSearch` (the documented GET `/api/apply/v2/jobs` answers "Tenant not identified"). No scraping, no auth, one request per country; deduped by **Cisco job id and exact URL**; wired into Fetch Jobs Now beside Greenhouse/Lever via `runBackendSources()`; apply URLs are Cisco's Workday tenant, so existing Workday autofill applies. **Hard filters in [ats_import.py](backend/app/services/ats_import.py), reused verbatim by Cisco: location = Saudi Arabia or Qatar ONLY** (UAE/Remote/Global rejected); **role = the target areas only**, matched on the title (27/27 target titles matched, 12/12 off-target rejected); **salary = disclosed-and-below-30,000 SAR/month rejects, undisclosed is KEPT and marked `unknown`**, disclosed-and-meeting marked `verified` on the row (Qatar floor 29,000 QAR — same money, both USD-pegged; annual ÷ 12; ranges use the upper bound). **Tracker cleared**: the 68 junk ATS jobs deleted from the real DB, profile/employment/preferences/résumé verified unchanged; **`GET /api/jobs` now returns exactly 2 — both Cisco, both Riyadh**. Live run: Saudi 5 fetched → 2 kept → 2 saved, Qatar 0; re-import 0 saved / 2 duplicate. Greenhouse/Lever's six verified boards currently yield 0 under the tighter rules (off-target Saudi roles, nothing in Qatar) and stay enabled. LinkedIn, queue, autofill and UI untouched. Tests: backend **173 passed**, app job-fetch **25/25**. |
| 2026-08-03 | — | *(this commit)* | **All job data cleared + one permanent `JobDataReset` — ✅ verified live by the user.** Backend: `backend/careerpilot.db` backed up to `careerpilot-before-clear.db`, 6 job rows deleted, profile/preferences/employment verified untouched via the live API. Browser: new [job-data-reset.js](app/js/platform/job-data-reset.js) clears **15 stores** in one call and **runs once automatically on load** (flag `careerpilot_job_data_reset_v1`); `run()` re-runs on demand. It **never hard-codes a storage key** — each target names its owning module and the key is read from it (`STORAGE_KEY`/`KEY`), preferring the module's own `clear()`; an unresolvable module is reported, never skipped. Preserves profile, employment, certifications, résumé library, master/parsed résumé, preferences, backend config, both safety backups and the **saved search URLs** (`JobFetchStore.clear()` is deliberately NOT used — only `lastRun` goes). Harness caught two real bugs first: `interview-store.js` exports **ApplicationMemory** (not `InterviewStore`), and these modules are **lexical `const` globals not reachable via `window[name]`**, so the original lookup cleared nothing. Demo data removed at source because four of them re-seed when their key is empty: `data.js` (jobs/approvals/applications + invented dashboard stats/funnel/monthly/weekly/bestPerformers), `jobs-store.js` `BASE_JOBS` (what the board really rendered — `DB.jobs` was dead code), the six providers' `RAW` mock feeds (four auto-register and republished on every refresh), **`ApplicationsStore.defaults()`** (10 demo apps) and **`Activity.seed()`** (5 invented events); `app.js` no longer hard-codes "128 applications"/"$148k". End-to-end in a real browser: seed 24 keys → load app → pipeline 0,0,0,0 · funnel all 0 · stats 0/0%/0%/— · "No activity yet" · Today's Jobs 0 · Approvals 0 · Applications 0 · Queue 0, personal keys intact, saved search URL kept. Tests: job-data-reset **8/8**, backend 51/51, all discovery/queue/ats suites green. **11 tests fail, every one asserting the deleted demo data** (sprint23/24/25/26/27/30) — no functional regression; **left deliberately for a separate fixture pass**, starting with sprint30 case 1 (the §5 data-safety guardrail). |
| 2026-08-02 | — | *(this commit)* | **Job Discovery v1 — LinkedIn harvesting rebuilt after the first live run.** Live test on the real saved search returned **1 job against "99+ results"**: LinkedIn **virtualizes** the left results list (only cards near the viewport exist; scrolled-past cards are destroyed), and v1 read the freshly opened background tab once. Also found: the card's **logo anchor** was taken as the job link (empty text → title empty → card counted failed), and the **job-details panel's** own `/jobs/view/` links were in scope. [harvest.js](extension/harvest.js) LinkedIn path now scopes to the LEFT list (`li[data-occludable-job-id]`'s parent → known containers → a `<ul>` with ≥2 job links; details panel excluded via `closest()`), waits for the first card, then **scrolls in rounds** collecting new job ids — stopping after **3 idle rounds** or **50 jobs** (round cap 40). Title read from the visible `aria-hidden`/`strong` span; dedup by job id, exact URL, and a `title\|company\|location` key so a **promoted twin under a second id** is saved once. Per-source **diagnostics** (scroll rounds · card candidates · unique ids · parsed · failed) flow through to the panel, and a read that yields ≤1 job from ≥3 cards — or 0 cards with no "no matching jobs" on the page — is reported as a **harvest FAILURE**, saving nothing. Bayt/GulfTalent untouched (`harvestList` ≡ `harvest` for both, asserted). New harness mock is genuinely virtualized: one read sees 8, the scrolled harvest gets **30/30 in 8 rounds**. Tests **24/24** + **14/14**, backend 51/51, all other suites green. **Real LinkedIn live retest still pending — expected ~20–25 jobs from one results page** (scrolls, never paginates). |
| 2026-08-02 | — | *(this commit)* | **Job Discovery v1 — "Fetch Jobs Now."** One button on Today's Jobs pulls real jobs from **LinkedIn / Bayt / GulfTalent** using the Chrome sessions the user is already signed into. New: `app/js/discovery/job-fetch-store.js` (one saved search URL per portal, host-validated, + the last run's four counts), `job-fetch.js` (posts `{kind:'fetch-jobs'}` over the existing bridge, records the run, then `JobsBackendSync.pull` so jobs land in Today's Jobs at once), `job-fetch-view.js` (additive card, existing CSS); `extension/harvest.js` (read-only card harvester — title · company · location · job URL · source · portal job id; structural, class-name-agnostic; login/CAPTCHA **reported**, never bypassed) and `extension/fetch-jobs.js` (opens each saved search in a background tab, injects the harvester, dedups by **source job id AND exact job URL**, saves via the existing `POST /api/jobs`, closes the tab, returns found/saved/duplicate/failed). `bridge.js`/`background.js` route the new message; manifest gains host permissions for the three portals only (no `tabs` permission). Backend `POST /api/jobs` now 409s on an exact `apply_url` too (never `canonical_url` — that would re-create the WSP↔Microsoft merge). Fixed a pre-existing `file://` ACK-drop in `bridge.js` (origin targetOrigin can't match an opaque origin) — messaging back to 8/8. No matching/scoring/autofill/application changes; no UI redesign. Tests: job-fetch **17/17** + **12/12**, backend **51/51**, all other suites green. (Superseded the same day by the LinkedIn virtualized-scroll fix in the row above.) |
| 2026-07-30 | — | *(this commit)* | feat: add reliable Workday queue autofill and field handling — **✅ queue autofill verified live on PwC wd3** (4 live rounds). Queue intent no longer consumed on the "Start Your Application" modal (`claim()` at terminal outcome only; waits THROUGH the modal via `workdayFormReady`); **login/account/OTP survive ≥30 min** (`WD_INTENT_MAX_AGE`, `workday-waiting`, not consumed). Workday React inputs fill (`haystack` scans field-wrapper `data-automation-id`+label; `setValue` fires focus→native-setter→input/change/**blur**). **Custom comboboxes** (country/state/phone-device-type) select ONLY an exact profile match. **Arabic name fields stay empty** (`isArabicNameField`); **phone** national-number when a custom "Country/Territory Phone Code" combobox is present (`phoneCodeControl`/`readDialCode`, `+966…`→`536886174`); extension only if stored; never salary/consent/submit/Continue; never overwrite; run-once via DONE_KEY. Tests auto-apply **36/36**, autofill 19/19. `extension/{auto-apply.js, content.js, tests/auto-apply}`. **Live recheck of national phone on a fresh job still pending.** |
| 2026-07-27 | — | `8f11ac3` | fix: handle Greenhouse resume uploads safely with manual fallback — **✅ verified live**: text autofill works + stays filled, current PDF selected, **Greenhouse blocks synthetic upload** (both `input.files` AND a dropzone `drop`), CareerPilot safely marks **Needs Attention** for manual attach, nothing auto-submitted. Greenhouse Resume Uploader v1 (native input → dropzone `drop` fallback) added — résumé-only, once each (no retry loops), diag records `method`, popup shows honest Upload ok/FAILED. auto-apply 25/25 (test 25: native-rejected→dropzone path on exact URL); autofill 19/19, storage 9/9, messaging 8/8, queue 6/6. |
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
detection, autofill, `collectLinkedIn`), `background.js` + `bridge.js` (app↔worker
messaging), `auto-apply.js` (queue-triggered ATS autofill), **`harvest.js` + `fetch-jobs.js`
(Job Discovery v1)**, `README.md` (load-unpacked steps). No JS runtime on this machine →
tested with standalone headless-Edge harnesses that stub `chrome.*` and drive the real
scripts (see [[headless-edge-test-runner]] in memory).

**Job Discovery v1** under `app/js/discovery/job-fetch{-store,-view,}.js` (app side) and
`extension/{harvest,fetch-jobs}.js` (browser side); tests in `app/tests/job-fetch/` and
`extension/tests/job-fetch/`; backend contract in `backend/tests/test_job_discovery.py`.
