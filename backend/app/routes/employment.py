"""Employment-history routes (Sprint 16 PART 4)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Employment, User
from ..schemas import EmploymentIn, EmploymentOut
from ..services.seed import current_user

router = APIRouter(prefix="/api/employment", tags=["employment"])


@router.get("", response_model=list[EmploymentOut])
def list_employment(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(Employment).filter_by(user_id=user.id).order_by(Employment.id).all()


@router.post("", response_model=EmploymentOut, status_code=201)
def create_employment(body: EmploymentIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.ext_id and db.query(Employment).filter_by(user_id=user.id, ext_id=body.ext_id).first():
        raise HTTPException(status_code=409, detail={"code": "duplicate", "message": f"employment {body.ext_id} already exists"})
    row = Employment(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{row_id}", response_model=EmploymentOut)
def get_employment(row_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Employment).filter_by(id=row_id, user_id=user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "employment not found"})
    return row


@router.put("/{row_id}", response_model=EmploymentOut)
def update_employment(row_id: int, body: EmploymentIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Employment).filter_by(id=row_id, user_id=user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "employment not found"})
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{row_id}", status_code=204)
def delete_employment(row_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Employment).filter_by(id=row_id, user_id=user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "employment not found"})
    db.delete(row)
    db.commit()
