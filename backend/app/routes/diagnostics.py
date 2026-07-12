"""Connector diagnostics + backend diagnostics summary (Sprint 16 PART 4, 8)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    ApplicationPackage, Conflict, ConnectorStatus, Employment, ErrorEntry,
    InterviewRecord, Job, KVEntry, Migration, SubmittedApplication, SyncOperation, User,
)
from ..schemas import ConnectorStatusIn, ConnectorStatusOut
from ..services.seed import current_user

router = APIRouter(prefix="/api", tags=["diagnostics"])


@router.get("/connectors", response_model=list[ConnectorStatusOut])
def list_connectors(db: Session = Depends(get_db)):
    return db.query(ConnectorStatus).order_by(ConnectorStatus.connector_id).all()


@router.post("/connectors", response_model=ConnectorStatusOut)
def upsert_connector(body: ConnectorStatusIn, db: Session = Depends(get_db)):
    row = db.query(ConnectorStatus).filter_by(connector_id=body.connector_id).first()
    if row:
        for k, v in body.model_dump().items():
            setattr(row, k, v)
    else:
        row = ConnectorStatus(**body.model_dump())
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/diagnostics")
def diagnostics(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Backend-side diagnostics for #/admin (Sprint 16 → 17)."""
    last = db.query(Migration).order_by(Migration.id.desc()).first()
    uid = user.id

    recent_failures = (db.query(ErrorEntry)
                       .filter_by(resolved=False)
                       .order_by(ErrorEntry.id.desc()).limit(10).all())
    recent_conflicts = (db.query(Conflict)
                        .filter_by(user_id=uid)
                        .order_by(Conflict.id.desc()).limit(10).all())

    return {
        "database": "connected",
        "counts": {
            "jobs": db.query(Job).filter_by(user_id=uid).count(),
            "employment": db.query(Employment).filter_by(user_id=uid).count(),
            "packages": db.query(ApplicationPackage).filter_by(user_id=uid).count(),
            "submitted": db.query(SubmittedApplication).filter_by(user_id=uid).count(),
            "interviews": db.query(InterviewRecord).filter_by(user_id=uid).count(),
            "connectors": db.query(ConnectorStatus).count(),
            "kv": db.query(KVEntry).filter_by(user_id=uid).count(),
        },
        "pending_sync": db.query(SyncOperation).filter(SyncOperation.status != "done").count(),
        "unresolved_errors": db.query(ErrorEntry).filter_by(resolved=False).count(),
        "conflicts": db.query(Conflict).filter_by(user_id=uid, resolved=False).count(),
        "recent_failures": [
            {"id": e.error_id, "category": e.category, "message": e.message, "severity": e.severity}
            for e in recent_failures
        ],
        "recent_conflicts": [
            {"id": c.id, "entity": c.entity, "entity_key": c.entity_key, "kind": c.kind, "message": c.message}
            for c in recent_conflicts
        ],
        "last_migration": None if not last else {
            "id": last.id, "status": last.status,
            "success": last.success_count, "failed": last.failed_count, "skipped": last.skipped_count,
            "finished_at": last.finished_at.isoformat() if last.finished_at else None,
        },
        "time": datetime.now(timezone.utc).isoformat(),
    }
