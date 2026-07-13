# CareerPilot AI — Handoff

**Single source of truth for project state.** New chat: read this, then continue from
**Next Up**. Rules, project shape, and how to run the tests live in
[CLAUDE.md](CLAUDE.md) — read that too.

- **Last updated:** 2026-07-13
- **Status:** 🟢 **v1.0 SHIPPED** (2026-07-13)
- **Branch:** `main` — clean, and `main == origin/main` (nothing unpushed)
- **Head:** `e4ec18a` — .gitignore repair
- **Remote:** github.com/engineerawais24/engineerawais

---

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

Nothing is mid-flight. These are the open post-v1 items, in rough priority order.

### User-side (not code — needs the user in the browser, Chrome Profile 4)

1. **Run certification recovery.** It is built but has never been executed. The
   preview/Restore button is on the **Resume Library** page. Until it is pressed, the
   user's recovered certifications are not back in the profile.
2. **Re-enter six unrecoverable profile fields by hand:** target roles, preferred
   locations, languages, work mode, job type, sponsorship flag. (Work authorization,
   minSalary and LinkedIn URL *are* recoverable from `careerpilot_prep_v1` / stored
   cover letters, if those keys exist.)

### Code / repo

3. **Packages created before the salary fields existed** still read "Salary not
   disclosed", and after the salary-edit revert there is **no UI to correct them**.
   Decide: leave as-is, or add a narrow one-off fixer.
4. **Repo hygiene before tagging** — see Open Issues #1 and #2. Roughly one commit.
5. **Tag `v1.0`** once the above is settled. **Pushing the tag needs explicit
   approval — ask.**

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
| 30 | `9e67065` | Version 1 final stabilization; salary-edit UI removed |
| — | `e4ec18a` | .gitignore repair (`.claude/`, corrupted UTF-16 `.venv` entry) |
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
