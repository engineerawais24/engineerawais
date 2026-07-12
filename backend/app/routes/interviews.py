"""Interview-record routes (Sprint 16 PART 4, 9).

The submitted snapshot is immutable — PATCH only ever updates the
mutable interview-tracking fields (status, interview, notes, follow-up,
events, mock), never `submitted`.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InterviewRecord, User
from ..schemas import InterviewRecordIn, InterviewRecordOut, InterviewUpdateIn
from ..services.seed import current_user

router = APIRouter(prefix="/api/interviews", tags=["interviews"])


@router.get("", response_model=list[InterviewRecordOut])
def list_interviews(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(InterviewRecord).filter_by(user_id=user.id).order_by(InterviewRecord.id.desc()).all()


@router.post("", response_model=InterviewRecordOut, status_code=201)
def create_interview(body: InterviewRecordIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    exists = db.query(InterviewRecord).filter_by(user_id=user.id, job_key=body.job_key).first()
    if exists:
        raise HTTPException(status_code=409, detail={"code": "duplicate", "message": f"interview record for {body.job_key} already exists"})
    row = InterviewRecord(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{job_key}", response_model=InterviewRecordOut)
def get_interview(job_key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(InterviewRecord).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "interview record not found"})
    return row


@router.patch("/{job_key}", response_model=InterviewRecordOut)
def update_interview(job_key: str, body: InterviewUpdateIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(InterviewRecord).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "interview record not found"})
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)   # never touches `submitted`
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{job_key}", status_code=204)
def delete_interview(job_key: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(InterviewRecord).filter_by(user_id=user.id, job_key=job_key).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "interview record not found"})
    db.delete(row)
    db.commit()
