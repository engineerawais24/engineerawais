"""API routers (Sprint 16 PART 2, 4, 6, 7)."""
from . import (
    health, session, profile, preferences, employment, jobs,
    applications, interviews, diagnostics, migration, kv,
)

routers = [
    health.router, session.router, profile.router, preferences.router,
    employment.router, jobs.router, applications.router, interviews.router,
    diagnostics.router, migration.router, kv.router,
]
