"""Generic key/value store for the frontend RESTStorageProvider
(Sprint 16 PART 5 · Sprint 17 PART 6).

Sprint 17 additions:
  • every entry is scoped to current_user
  • `updated_at` is returned so hydration can compare recency
  • batch upsert/delete for efficient queue flushes

The Sprint 16 response shapes are preserved (list still returns a
plain `keys` array of strings) so the existing tests keep passing.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import KVEntry, User
from ..services.seed import current_user

router = APIRouter(prefix="/api/kv", tags=["kv"])


def _iso(dt) -> Optional[str]:
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt else None


class BatchIn(BaseModel):
    upserts: list[dict[str, Any]] = Field(default_factory=list)   # [{key, value}]
    deletes: list[str] = Field(default_factory=list)


@router.get("")
def list_keys(prefix: Optional[str] = Query(None), db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = db.query(KVEntry).filter(KVEntry.user_id == user.id)
    if prefix:
        q = q.filter(KVEntry.key.like(prefix + "%"))
    rows = q.order_by(KVEntry.key).all()
    return {
        "keys": [r.key for r in rows],                                   # Sprint 16 shape (preserved)
        "entries": [{"key": r.key, "updated_at": _iso(r.updated_at)} for r in rows],
        "count": len(rows),
    }


@router.delete("")
def clear_prefix(prefix: str = Query(...), db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = (db.query(KVEntry)
         .filter(KVEntry.user_id == user.id, KVEntry.key.like(prefix + "%"))
         .delete(synchronize_session=False))
    db.commit()
    return {"ok": True, "removed": n}


@router.post("/batch")
def batch(body: BatchIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Apply many KV writes/deletes at once (Sprint 17 queue flush)."""
    upserted, deleted = 0, 0
    for item in body.upserts:
        key = str(item.get("key") or "").strip()
        if not key:
            raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "batch upsert item requires a key"})
        row = db.query(KVEntry).filter_by(user_id=user.id, key=key).first()
        if row:
            row.value = item.get("value")
        else:
            db.add(KVEntry(user_id=user.id, key=key, value=item.get("value")))
        upserted += 1
    for key in body.deletes:
        row = db.query(KVEntry).filter_by(user_id=user.id, key=str(key)).first()
        if row:
            db.delete(row)
            deleted += 1
    db.commit()
    return {"ok": True, "upserted": upserted, "deleted": deleted, "at": datetime.now(timezone.utc).isoformat()}


@router.get("/{key}")
def get_value(key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(KVEntry).filter_by(user_id=user.id, key=key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "key not found"})
    return {"key": row.key, "value": row.value, "updated_at": _iso(row.updated_at)}


@router.put("/{key}")
def set_value(key: str, value: Any = Body(..., embed=True), db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(KVEntry).filter_by(user_id=user.id, key=key).first()
    if row:
        row.value = value
    else:
        row = KVEntry(user_id=user.id, key=key, value=value)
        db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "key": key, "updated_at": _iso(row.updated_at)}


@router.delete("/{key}")
def delete_value(key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(KVEntry).filter_by(user_id=user.id, key=key).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True, "key": key}
