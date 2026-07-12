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
& Persistence** card → **Test backend connection**, then **Migrate
local data**. The frontend defaults to local `localStorage` and only
uses the backend once its health check succeeds. Local data is never
deleted.
