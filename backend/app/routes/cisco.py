"""Cisco jobs import (careers.cisco.com public search).

POST /api/cisco/import  → fetch Cisco's current Saudi Arabia / Qatar postings,
apply the existing location / role / salary filters, and save each survivor as
a Job (deduped by Cisco job id and exact URL). Returns the same
found / saved / duplicate / failed shape the ATS import returns.

Reuses the existing Job storage and the existing filters; adds no model.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..services import cisco_import
from ..services.seed import current_user

router = APIRouter(prefix="/api/cisco", tags=["cisco"])


@router.get("/countries")
def list_countries():
    """Which countries are searched (no network call)."""
    return {"countries": list(cisco_import.COUNTRIES), "source": cisco_import.SOURCE}


@router.post("/import")
def import_cisco(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return cisco_import.import_all(db, user)
