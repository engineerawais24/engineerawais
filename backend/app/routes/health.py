"""Health + status endpoints (Sprint 16 PART 2)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import ApplicationPackage, InterviewRecord, Job, SubmittedApplication
from ..schemas import HealthOut, StatusOut

router = APIRouter(prefix="/api", tags=["health"])
settings = get_settings()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db_ok(db: Session) -> bool:
    try:
        db.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)):
    return HealthOut(
        status="ok" if _db_ok(db) else "degraded",
        service=settings.app_name,
        api_version=settings.api_version,
        time=_now_iso(),
    )


@router.get("/status", response_model=StatusOut)
def status(db: Session = Depends(get_db)):
    ok = _db_ok(db)
    counts = {
        "jobs": db.query(Job).count(),
        "packages": db.query(ApplicationPackage).count(),
        "submitted": db.query(SubmittedApplication).count(),
        "interviews": db.query(InterviewRecord).count(),
    }
    return StatusOut(
        service=settings.app_name,
        status="ok" if ok else "degraded",
        database="connected" if ok else "unavailable",
        api_version=settings.api_version,
        environment=settings.environment,
        time=_now_iso(),
        storage_provider=settings.storage_provider,
        counts=counts,
    )
