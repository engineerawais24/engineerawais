# CareerPilot Backend (Sprint 16)

First local backend for CareerPilot — **Python + FastAPI + SQLite +
SQLAlchemy + Pydantic**. It gives the existing browser frontend a real
API to persist data outside `localStorage`, without changing any
frontend behaviour. SQLite is the local default; the same code runs on
PostgreSQL by changing only `DATABASE_URL`.

> No job-board scraping and no automatic application submission are
> implemented here. No credentials are required or committed.

## Structure

```
backend/
  app/
    main.py          FastAPI app, CORS, error envelope, startup init
    config.py        env-driven settings (no secrets in code)
    database.py      SQLAlchemy engine/session/Base + init_db()
    models/          14 entities (profile … migrations) + kv
    schemas/         Pydantic request/response models
    routes/          health, session, profile, preferences, employment,
                     jobs, applications, interviews, diagnostics,
                     migration, kv
    services/        dev-user seed + idempotent migration
  tests/             pytest suite
  requirements.txt   pinned dependencies
  .env.example       copy to .env (never commit .env)
```

## Install & run (Windows / PowerShell)

From the repo root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env          # optional — sane defaults work as-is
uvicorn app.main:app --reload --port 8000
```

Then:

- API root: http://127.0.0.1:8000/
- Swagger docs: http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/api/health

The SQLite file `careerpilot.db` is created automatically on first run
(git-ignored).

### Command Prompt (cmd.exe) variant

```bat
cd backend
python -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest
```

Each test uses a throwaway temporary SQLite database — your real
`careerpilot.db` is never touched.

## Move to PostgreSQL later (no code change)

```
# .env
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/careerpilot
```

(Install a driver such as `psycopg[binary]`; everything else is
identical.)

## Frontend connection

In the CareerPilot app open the hidden **`#/admin`** screen → **Backend
& Persistence** card. The frontend defaults to local `localStorage` and
only uses the backend once its health check succeeds. Local data is
never deleted.

---

# Sprint 17 — Live sync & two-way persistence

> ⚠️ **Schema change:** `kv_entries` is now scoped per user. If you ran
> Sprint 16 already, delete the dev database once so the new tables are
> created: `Remove-Item backend\careerpilot.db`. This only affects the
> local dev DB — your browser data is untouched and is the source of
> truth.

## How LOCAL mode works (the default)

Everything is written to `localStorage` synchronously. The app is fully
usable with **no backend running at all**. Nothing is ever sent
anywhere. This is the default and stays the default until you
explicitly switch.

## How BACKEND mode works

`#/admin` → **Switch to Backend Mode**. It **tests connectivity first**;
if the backend is unreachable the app stays in local mode.

On success the active `StorageProvider` becomes the
**RESTStorageProvider**, which is *offline-first*:

- **Reads are still synchronous and instant** — served from a local
  **mirror** (the same `localStorage` namespace). There are never any
  synchronous network calls.
- **Writes go to the mirror first**, then are pushed to
  `PUT/DELETE /api/kv/{key}` in the background.
- If the push fails, the value **stays in the mirror** and the operation
  is **queued** on the SyncManager. Nothing is lost.

## How HYDRATION works

**Hydrate From Backend** pulls `/api/kv` into the local mirror:

1. list the backend keys for this namespace (with `updated_at`),
2. for each key, if a **local write has not been confirmed by the
   backend yet and is at least as new**, the **local value wins** — it is
   kept, and the difference is recorded as a conflict,
3. otherwise the backend value is merged into the mirror.

Hydration **never deletes unknown local keys** and **never overwrites a
newer unsynced local write**. If hydration fails the app simply keeps
using the mirror — no data loss.

Domain hydration this sprint: **profile + preferences** are merged back
**fill-if-empty** (a populated local store always wins; a difference is
recorded as a conflict). All other entities are pushed and fetched into
a read-only backend snapshot used for the admin comparison.

## How the OFFLINE QUEUE and FLUSH work

Queued operations are drained **FIFO** and an operation is removed
**only after a confirmed backend success**. Failures stay queued.

- bounded retry (`MAX_ATTEMPTS = 5`), then the op moves to the
  failed-operation history,
- **permanent 4xx** (400/401/403/404/409/422) are marked `permanent` and
  are **never auto-retried** — they stay visible for diagnostics until
  you press **Retry Failed Operations**,
- a **concurrency lock** prevents two flushes running at once,
- flushing is async and never blocks the UI.

A flush is triggered when: the connection test succeeds · backend mode
is activated · the browser fires `online` · the app starts and backend
mode was previously enabled · you press **Sync Now**.

## CONFLICT behaviour

Neither side is ever discarded.

| Case | Behaviour |
|---|---|
| Local unsynced write newer than backend | **Local wins**; backend version recorded as a conflict |
| Backend `409` on a queued op | Op stays queued + `permanent`; local payload kept; conflict recorded |
| Duplicate **submitted** snapshot | Backend **never overwritten**; `provenance` conflict recorded |
| Duplicate **interview** `submitted` | Backend **never overwritten**; only mutable tracking fields are PATCHed |
| Profile differs | **Local kept**; backend version recorded as a conflict |

Conflicts appear in `#/admin` and can be posted to `POST /api/conflicts`.

## Commands

```powershell
# run the backend
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000

# backend tests
pytest

# frontend harnesses (open in a browser — no backend required)
start "" "..\app\tests\sprint17.html"
start "" "..\app\tests\sprint16.html"
start "" "..\app\tests\sprint15.html"
start "" "..\app\tests\sprint14.html"
```

---

# Sprint 18 — Intelligent Job Search Engine

> **No backend changes were made in Sprint 18.** Search history, the
> search cache and search diagnostics all persist through the existing
> `AppStorage` abstraction, so they already work in **local mode** and —
> in **backend mode** — sync to `/api/kv` automatically via Sprint 17.
> No new endpoints, models or migrations were required.

## What this is (and is NOT)

It is a **provider abstraction** over **local mock feeds** with an
**injectable transport**.

It is **NOT** real LinkedIn API access, **NOT** real Indeed API access,
**NOT** scraping, **NOT** automated application submission, and **NOT**
production authentication. No credentials exist anywhere in the code.

## Search architecture

```
SearchView (UI panel, above Today's Jobs)
      │
      ▼
SearchEngine ── providers (fan-out, failure-isolated)
      │            LinkedIn · Indeed · Bayt · GulfTalent · Greenhouse · Lever
      ├─ normalize  → UnifiedJob (30 fields, no provider fields leak)
      ├─ filter     → titles/locations/countries/mode/salary/experience/keywords
      ├─ deduplicate→ URL + company/title/location/description similarity
      ├─ rank       → SearchRanking (deterministic 0–100 + explanation)
      ├─ cache      → SearchCache (TTL, stale-while-refresh, bounded)
      └─ history    → AppStorage (bounded, rerunnable)
      │
      ▼
SearchEngine.toDiscovered() → JobsStore.setDiscovered() → Jobs.reload()
      → the EXISTING MatchEngine / DecisionEngine / Approve-Later-Reject flow
```

The engine **never touches the DOM** and **never submits an application**.

## Provider abstraction

Each provider implements `connect(config)`, `search(filters, context)`,
`normalize(rawJob)`, `health()`, `disconnect()` and reports
`configured · connected · reachable · lastSuccessAt · lastFailureAt ·
resultCount · lastError`. A provider failure is captured and reported —
it **never fails the whole search**. Cancellation propagates via an
`AbortSignal`.

## Unified job model

30 fields (`id … updatedAt`). Unknowns are consistently `null` / `[]` /
`false`. URLs are canonicalized *before* duplicate detection; dates are
ISO. After a merge, every original provider name is preserved in
`providers[]` and every source URL/ID in `mergeMeta`.

## Deduplication

Deterministic: the input is sorted, then grouped by canonical URL, same
source-id, or a weighted similarity (company 0.38 · title 0.34 ·
location 0.18 · description 0.10) against a configurable threshold
(0.82). The **most complete** record wins, ties break on the **newest
`postedAt`**, and provenance is merged — never lost. The same input
always produces the same output.

## Ranking

Deterministic and fully explainable — no randomness, no `Date.now()` in
the scoring path. Weights: skills 25 · salary 12 · location 12 · title
12 · resume 10 · experience 8 · remote 6 · certifications 5 · seniority
4 · employmentType 2 · visa 2 · keywords 2, plus an excluded-keyword
penalty and a bounded prior-decision bonus/penalty. Riyadh and Saudi
Arabia rank highest on location, then GCC, then remote.

Output per job: `score · scoreBand · reasons[] · strengths[] · gaps[] ·
warnings[] · matchedSkills[] · missingSkills[] · salaryAssessment ·
locationAssessment · recommendation`.

It is **additive**: MatchEngine, DecisionEngine, the GCC/salary rules and
the company ranking still govern the approval workflow unchanged.

## Cache · offline · history

Cache key = filters + providers + ranking version + relevant
preferences. Fresh → instant hit. Expired → the **stale entry is still
served instantly** and a background refresh runs (stale-while-refresh).
Offline → cached results are served (a cache miss offline is empty and
safe, never an error). Bounded to 25 entries with deterministic LRU
eviction. History keeps the last 30 searches with all 17 fields and is
rerunnable.

## Diagnostics (`#/admin` → Search engine)

Total searches · today · average duration · average results · cache hit
rate · stale hits · duplicates merged · average score · provider health ·
provider failures · last successful/failed search · active search ·
cancelled · offline. Actions: **Clear expired cache · Refresh provider
health · Run diagnostics search · Cancel active search · Export search
diagnostics**. Clearing expired cache only removes stale *search result*
entries — it never touches jobs, decisions, applications, interviews,
résumés, profile or preferences.

## Test commands (Sprint 18)

```powershell
# frontend harness (no backend needed)
start "" "c:\Users\m.awais\Desktop\Job Prject\app\tests\sprint18.html"

# previous harnesses still apply
start "" "c:\Users\m.awais\Desktop\Job Prject\app\tests\sprint17.html"
start "" "c:\Users\m.awais\Desktop\Job Prject\app\tests\sprint16.html"

# backend suite is UNCHANGED by Sprint 18
cd backend; .\.venv\Scripts\Activate.ps1; pytest
```

## Manual verification (Sprint 18)

1. Open the app → **Today's Jobs** → the **Job search** card is above the
   existing list. Click **Open search**.
2. Pick providers, set filters, press **Search**. Watch the result count,
   duplicate count, cache/offline indicators and provider health chips.
3. The ranked results show a score, band and explanation. All results are
   loaded into **Today's Jobs below** — approve / later / reject as usual.
4. Press **Search** again with the same filters → the `from cache` chip
   appears. **Force refresh** skips the cache.
5. Press **Cancel** during a search → it stops safely.
6. Use **Rerun** on a recent search.
7. `#/admin` → **Search engine** section → try the five actions.

## Known limitations (Sprint 18)

- Providers are **mock feeds**, not live APIs. Live mode would require a
  backend-held credential reference and a real transport — neither
  exists.
- Ranking recency is deliberately excluded from the score to guarantee
  determinism.
- The search panel shows ranking explanations; the existing Today's Jobs
  cards are unchanged and do not yet display the search score inline.
- Dedup similarity is lexical (token/Jaccard), not semantic.
- Search history/cache are per-browser via `AppStorage` (synced to the
  backend KV only when backend mode is on).

---

## Known limitations (Sprint 17)

- **Not full cloud sync, and no authentication.** One local development
  user (`current_user`); no login, no multi-user, no multi-device.
- **Domain hydration is partial**: only *profile* and *preferences* are
  merged back into the local stores (fill-if-empty). Jobs, employment,
  decisions, packages, submitted applications, interviews and connector
  statuses are **push-only** this sprint; they are fetched into a
  read-only snapshot for the admin comparison. Jobs are pushed with the
  full normalized record in `raw`, so rebuilding packages from the
  backend is ready for a future sprint.
- Conflict resolution is **deterministic, not interactive** — the local
  version always stays authoritative; there is no merge UI.
- Employment/jobs use POST-with-409-skip (no backend-side update by id).
- KV batch endpoint exists but the frontend flush still writes per key.
- No websockets/push: hydration is manual or on activation/boot.
