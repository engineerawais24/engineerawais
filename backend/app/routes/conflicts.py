"""Conflict recording + reporting (Sprint 17 PART 4, 6).

Neither side of a conflict is ever discarded: the frontend keeps the
local version authoritative locally and posts the losing/backend
version here so it survives in diagnostics.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Conflict, User
from ..schemas import ConflictIn, ConflictOut
from ..services.seed import current_user

router = APIRouter(prefix="/api/conflicts", tags=["conflicts"])


@router.get("", response_model=list[ConflictOut])
def list_conflicts(
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return (db.query(Conflict)
            .filter_by(user_id=user.id)
            .order_by(Conflict.id.desc())
            .limit(limit).all())


@router.post("", response_model=ConflictOut, status_code=201)
def record_conflict(body: ConflictIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = Conflict(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/{conflict_id}/resolve", response_model=ConflictOut)
def resolve_conflict(conflict_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Conflict).filter_by(id=conflict_id, user_id=user.id).first()
    if row:
        row.resolved = True
        db.commit()
        db.refresh(row)
    return row
