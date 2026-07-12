"""Application-package + submitted-application routes (Sprint 16 PART 4, 9).

Submitted applications are PROVENANCE records: once created they are
never overwritten (a re-POST of an existing job_key returns 409).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ApplicationPackage, SubmittedApplication, User
from ..schemas import (
    ApplicationPackageIn, ApplicationPackageOut,
    SubmittedApplicationIn, SubmittedApplicationOut,
)
from ..services.seed import current_user

router = APIRouter(prefix="/api/applications", tags=["applications"])


# ---------- prepared packages ----------
@router.get("/packages", response_model=list[ApplicationPackageOut])
def list_packages(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(ApplicationPackage).filter_by(user_id=user.id).order_by(ApplicationPackage.id.desc()).all()


@router.post("/packages", response_model=ApplicationPackageOut, status_code=201)
def upsert_package(body: ApplicationPackageIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(ApplicationPackage).filter_by(user_id=user.id, job_key=body.job_key).first()
    if row:
        for k, v in body.model_dump().items():
            setattr(row, k, v)
    else:
        row = ApplicationPackage(user_id=user.id, **body.model_dump())
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/packages/{job_key}", response_model=ApplicationPackageOut)
def get_package(job_key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(ApplicationPackage).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "package not found"})
    return row


@router.delete("/packages/{job_key}", status_code=204)
def delete_package(job_key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(ApplicationPackage).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "package not found"})
    db.delete(row)
    db.commit()


# ---------- submitted applications (immutable provenance) ----------
@router.get("/submitted", response_model=list[SubmittedApplicationOut])
def list_submitted(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(SubmittedApplication).filter_by(user_id=user.id).order_by(SubmittedApplication.id.desc()).all()


@router.post("/submitted", response_model=SubmittedApplicationOut, status_code=201)
def create_submitted(body: SubmittedApplicationIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    exists = db.query(SubmittedApplication).filter_by(user_id=user.id, job_key=body.job_key).first()
    if exists:
        raise HTTPException(status_code=409, detail={"code": "provenance_locked", "message": f"submitted application for {body.job_key} already recorded and cannot be overwritten"})
    row = SubmittedApplication(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/submitted/{job_key}", response_model=SubmittedApplicationOut)
def get_submitted(job_key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(SubmittedApplication).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "submitted application not found"})
    return row
