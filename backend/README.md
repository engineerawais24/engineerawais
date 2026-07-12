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
