"""ATS import route (Greenhouse / Lever public feeds).

POST /api/ats/import  → fetch every enabled company in ats_sources.json,
normalise each posting and save it as a Job (deduped by URL). Returns a
per-company summary. Reuses the existing Job storage; adds no new model.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..services import ats_import
from ..services.seed import current_user

router = APIRouter(prefix="/api/ats", tags=["ats"])


@router.get("/sources")
def list_sources():
    """The configured companies (no network call)."""
    return {"companies": ats_import.load_config()}


@router.post("/import")
def import_enabled(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return ats_import.import_all(db, user)
