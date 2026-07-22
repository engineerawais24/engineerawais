# CareerPilot AI — Handoff

**Single source of truth for project state.** New chat / new agent: read this top to
bottom, then continue from **Next Up**. Rules, project shape, and how to run the tests
live in [CLAUDE.md](CLAUDE.md) — read that too.

- **Last updated:** 2026-07-14
- **Status:** 🟢 **v1.0 SHIPPED** (2026-07-13) · Chrome extension + real ATS import added since
- **Branch:** `main` — clean, **ahead of origin by 2** (`961c6a0`, `88b4e46` unpushed)
- **Head:** `88b4e46` — real ATS job source (Greenhouse + Lever)
- **Remote:** github.com/engineerawais24/engineerawais

> ### ⚙️ Working agreement — for ANY agent editing this repo
> 1. **Update this file after every finished task**, before telling the user you're done —
>    the header block (Last updated / Status / Branch / Head), the **Done** and **Open**
>    to-do lists, and a **Sprint Log** row. A finished task with a stale handoff is not
>    finished. (This is CLAUDE.md §2, restated here so it's unmissable.)
> 2. **Commit freely; never `git push` without explicit approval** — every time, no carry-over.
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

**Open — code/repo:**
- [ ] **Push `961c6a0` + `88b4e46`** (2 unpushed) — **needs explicit approval**
- [ ] Delete dead root files: `index.html`, `index_backup.html`, `test` (the app is `app/index.html`)
- [ ] Tag `v1.0` after hygiene lands — **pushing the tag needs explicit approval**
- [ ] Decide: pre-salary-field packages still read "Salary not disclosed" with no UI to fix them — leave, or add a one-off fixer

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
  [app/tests/sprint30/sprint30.html](app/tests/sprint30/sprint30.html), 12 cases) is
  complete, including demo-data isolation, additive résumé sync, cert recovery, and
  backup export/import.
- `9e67065` removed the salary-editing UI for discovered jobs ahead of release. Salary
  entry survives only for **imported** jobs; the salary chip and the import-form
  currency/period fields were deliberately kept ("Edit UI only" revert scope).
- **No `v1.0` git tag exists yet** — the release was a push to `main`, not a tag.

## Next Up

Nothing is mid-flight. Immediate: **ask to push the 2 unpushed commits** (`961c6a0`,
`88b4e46`), then the repo-hygiene items (delete the 3 dead root files) and the `v1.0`
tag. The user-side items — live-DOM smoke test of the extension, enabling ATS
companies, cert recovery — happen whenever the user is at their browser.

The extension and ATS importer are the current active thread; the app itself (Sprints
1–30) is stable and shipped.

## Open Issues

1. **Dead files at repo root.** `index.html` and `index_backup.html` are "Bundled Page"
   artifacts from the initial commit — **not** the app (the app is
   [app/index.html](app/index.html)). There is also an empty file literally named
   `test`. All three are deletion candidates.
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

| Sprint | Commit | Summary |
|--------|--------|---------|
| — | `88b4e46` | Real ATS job source: public Greenhouse + Lever feeds |
| — | `961c6a0` | LinkedIn importer: anchor-first collection + structural parsing |
| — | `2f0b725` | Fix LinkedIn importer: collect the whole results list |
| — | `24c5114` | Extension: real LinkedIn Jobs list import |
| — | `51215de` | Extension autofill v1.1: authorization fields, radios, essays, salary never filled |
| — | `099da7c` / `64ae7e2` | Handoff updates (extension MVP pushed) |
| — | `276f7a0` | Chrome extension MVP: save job + autofill from profile |
| — | `a0a1d22` | Un-track `.venv` (5,397 files) |
| — | `1a5e718` | Handoff: milestones table + v1.0 to-do list |
| — | `88732e7` | CLAUDE.md operating rules + HANDOFF.md handoff protocol |
| — | `e4ec18a` | .gitignore repair (`.claude/`, corrupted UTF-16 `.venv` entry) |
| 30 | `9e67065` | Version 1 final stabilization; salary-edit UI removed — **v1.0** |
| 29 | `2c3e7df` | Intelligent weighted job matching |
| 28 | `4d6f10f` | Profile recovery & résumé parsing stabilization |
| 27 | `8e8928f` | Résumé tailoring & application package builder |
| 26 | `7d94760` | Job import & approval workflow |
| 25 | `6c9599e` | Multi-source job discovery engine |
| 24 | `6fa0849` | Application pipeline & workflow enhancements |
| 23 | `5ab66e0` | Application package preparation |
| 22 | `85545fb` | Cover letter generator |
| 21 | `80ede7a` | Résumé recommendation engine |
| 20 | `ff7e5ed` | Enhanced job match scoring |
| 19 | `91d83d2` | Advanced search & saved searches |
| 18 | `ff39070` | Job search engine & multi-source aggregation |
| 17 | `46971ac` | Live backend sync & two-way persistence |
| 16 | `4d81b43` | Local backend, database & real persistence MVP |
| 15 | `9a982f4` | Live connector integration layer |
| 14 | `aea5c8b` | Backend integration foundation |
| 13 | `404a902` | Interview copilot & application memory |
| 12 | `6da0677` | Application automation & submission readiness |
| 11 | `e8858e1` | Production connector framework |
| ≤10 | *see `git log`* | Core UI, connectors, application pipeline |

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
