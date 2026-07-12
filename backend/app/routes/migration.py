"""Migration routes (Sprint 16 PART 6)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Migration, User
from ..schemas import MigrationBundle, MigrationPreview, MigrationResult
from ..services.migration import run_migration
from ..services.seed import current_user

router = APIRouter(prefix="/api/migrate", tags=["migration"])


@router.post("/preview", response_model=MigrationPreview)
def preview(bundle: MigrationBundle, db: Session = Depends(get_db), user: User = Depends(current_user)):
    result = run_migration(db, user, bundle, execute=False)
    entities = {k: v["success"] for k, v in result["counts"].items()}
    return MigrationPreview(entities=entities, total=result["success_count"])


@router.post("", response_model=MigrationResult)
def migrate(bundle: MigrationBundle, db: Session = Depends(get_db), user: User = Depends(current_user)):
    result = run_migration(db, user, bundle, execute=True)
    return MigrationResult(**result)


@router.get("/history")
def history(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.query(Migration).order_by(Migration.id.desc()).limit(20).all()
    return [
        {
            "id": m.id, "status": m.status, "success": m.success_count,
            "failed": m.failed_count, "skipped": m.skipped_count,
            "finished_at": m.finished_at.isoformat() if m.finished_at else None, "note": m.note,
        }
        for m in rows
    ]
