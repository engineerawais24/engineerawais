"""Generic key/value store for the frontend RESTStorageProvider
(Sprint 16 PART 5). Opaque JSON blobs, namespaced by the caller.
"""
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import KVEntry

router = APIRouter(prefix="/api/kv", tags=["kv"])


@router.get("")
def list_keys(prefix: Optional[str] = Query(None), db: Session = Depends(get_db)):
    q = db.query(KVEntry)
    if prefix:
        q = q.filter(KVEntry.key.like(prefix + "%"))
    return {"keys": [r.key for r in q.order_by(KVEntry.key).all()]}


@router.delete("")
def clear_prefix(prefix: str = Query(...), db: Session = Depends(get_db)):
    n = db.query(KVEntry).filter(KVEntry.key.like(prefix + "%")).delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "removed": n}


@router.get("/{key}")
def get_value(key: str, db: Session = Depends(get_db)):
    row = db.query(KVEntry).filter_by(key=key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "key not found"})
    return {"key": row.key, "value": row.value}


@router.put("/{key}")
def set_value(key: str, value: Any = Body(..., embed=True), db: Session = Depends(get_db)):
    row = db.query(KVEntry).filter_by(key=key).first()
    if row:
        row.value = value
    else:
        row = KVEntry(key=key, value=value)
        db.add(row)
    db.commit()
    return {"ok": True, "key": key}


@router.delete("/{key}")
def delete_value(key: str, db: Session = Depends(get_db)):
    row = db.query(KVEntry).filter_by(key=key).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True, "key": key}
