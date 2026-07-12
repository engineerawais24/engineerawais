"""Connector diagnostics + backend diagnostics summary (Sprint 16 PART 4, 8)."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    ApplicationPackage, ConnectorStatus, ErrorEntry, InterviewRecord, Job,
    Migration, SubmittedApplication, SyncOperation, User,
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
    last = db.query(Migration).order_by(Migration.id.desc()).first()
    return {
        "database": "connected",
        "counts": {
            "jobs": db.query(Job).count(),
            "packages": db.query(ApplicationPackage).count(),
            "submitted": db.query(SubmittedApplication).count(),
            "interviews": db.query(InterviewRecord).count(),
            "connectors": db.query(ConnectorStatus).count(),
        },
        "pending_sync": db.query(SyncOperation).filter(SyncOperation.status != "done").count(),
        "unresolved_errors": db.query(ErrorEntry).filter_by(resolved=False).count(),
        "last_migration": None if not last else {
            "id": last.id, "status": last.status,
            "success": last.success_count, "failed": last.failed_count, "skipped": last.skipped_count,
            "finished_at": last.finished_at.isoformat() if last.finished_at else None,
        },
        "time": datetime.now(timezone.utc).isoformat(),
    }
