# CareerPilot AI — Handoff

**Single source of truth for project state.** New chat: read this, then continue from
**Next Up**. Rules, project shape, and how to run the tests live in
[CLAUDE.md](CLAUDE.md) — read that too.

- **Last updated:** 2026-07-13
- **Status:** 🟢 **v1.0 SHIPPED** (2026-07-13)
- **Branch:** `main` — clean, **ahead of origin by 1** (`88732e7` unpushed; pushes need explicit approval)
- **Head:** `88732e7` — CLAUDE.md operating rules + this handoff
- **Remote:** github.com/engineerawais24/engineerawais

---

## Milestones

| # | Milestone | Sprints | Status |
|---|-----------|---------|--------|
| M1 | Core product — profile, résumé library, job board, approvals, tracker, interview prep | 1–13 | ✅ Done |
| M2 | Platform & backend — storage abstraction, connectors, FastAPI + two-way sync, search engine | 14–18 | ✅ Done |
| M3 | Intelligence — saved searches, scoring v1/v2, résumé recommendation, cover letters, packages, discovery, imports, parsing | 19–29 | ✅ Done |
| M4 | **v1.0 release** — stabilization, demo-data isolation, backup/restore, salary visibility | 30 | ✅ **Shipped 2026-07-13** |
| M5 | Post-v1 hardening — repo hygiene, `v1.0` tag, user data recovery | — | 🔶 In progress (see To-do) |

## To-do (v1.0 → v1.0-tagged)

**Done since release:**
- [x] `.gitignore` repaired — `.claude/` ignored, corrupted UTF-16 `.venv` entry fixed (`e4ec18a`)
- [x] Cross-session handoff protocol — CLAUDE.md rules + HANDOFF.md state doc (`88732e7`)
- [x] Memory notes for future sessions (test-runner technique, data-safety rules, approval rules)

**Open — code/repo (each ≈ one commit):**
- [ ] Un-track `.venv/` — 5,397 files still in git (`git rm -r --cached .venv`); ignore rule alone doesn't untrack
- [ ] Delete dead root files: `index.html`, `index_backup.html`, `test` (the app is `app/index.html`)
- [ ] Push `88732e7` (+ any hygiene commits) — **needs explicit approval**
- [ ] Tag `v1.0` after hygiene lands — **pushing the tag needs explicit approval**
- [ ] Decide: pre-salary-field packages still read "Salary not disclosed" with no UI to fix them — leave, or add a one-off fixer

**Open — user-side (browser, Chrome Profile 4; not code):**
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

Nothing is mid-flight. Work through the **To-do** list above, top to bottom: the next
concrete action is the repo-hygiene pair (un-track `.venv/`, delete the three dead
root files), then ask for approval to push, then tag `v1.0`. The user-side recovery
items can happen in parallel whenever the user is in their browser.

## Open Issues

1. **`.venv/` is still tracked in git — 5,397 files.** The `.gitignore` rule landed in
   `e4ec18a`, but the files were committed *before* it and were never un-tracked;
   ignore rules do not apply to already-tracked paths. Fix: `git rm -r --cached .venv`,
   then commit. It dwarfs the ~180 files of real source and makes every diff review
   painful.
2. **Dead files at repo root.** `index.html` and `index_backup.html` are "Bundled Page"
   artifacts from the initial commit — **not** the app (the app is
   [app/index.html](app/index.html)). There is also an empty file literally named
   `test`. All three are deletion candidates.
3. **Historical commits carry `Co-Authored-By: Claude`** (through `e4ec18a`). The
   no-AI-attribution rule applies **going forward**; history is not being rewritten
   without an explicit request.
4. **Sprint 18's harness cannot run headlessly.** Needs a real browser window. Known.

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

Backend under `backend/app/`: `routes/` · `models/` · `schemas/` · `services/`, with
`tests/` alongside.

Screen registry and hash router: [app/js/app.js](app/js/app.js) — includes hidden
screens `#/admin` (System Diagnostics), `#/review`, `#/resumeReview`.
