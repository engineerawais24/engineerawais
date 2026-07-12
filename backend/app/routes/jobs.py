"""Job + decision routes (Sprint 16 PART 4).

Creating a job with a (source, source_job_id) that already exists
returns 409 — duplicate protection (PART 10).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Job, JobDecision, User
from ..schemas import JobIn, JobOut, JobDecisionIn, JobDecisionOut
from ..services.seed import current_user

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobOut])
def list_jobs(limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(Job).filter_by(user_id=user.id).order_by(Job.id.desc()).limit(limit).all()


@router.post("", response_model=JobOut, status_code=201)
def create_job(body: JobIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    exists = db.query(Job).filter_by(user_id=user.id, source=body.source, source_job_id=body.source_job_id).first()
    if exists:
        raise HTTPException(status_code=409, detail={"code": "duplicate", "message": f"job {body.source}:{body.source_job_id} already exists"})
    row = Job(user_id=user.id, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# --- decisions (declared before /{job_id} so the path doesn't shadow it) ---
@router.get("/decisions", response_model=list[JobDecisionOut])
def list_decisions(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(JobDecision).filter_by(user_id=user.id).order_by(JobDecision.id.desc()).all()


@router.post("/decisions", response_model=JobDecisionOut, status_code=201)
def create_decision(body: JobDecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(JobDecision).filter_by(user_id=user.id, job_ext_id=body.job_ext_id).first()
    if row:
        for k, v in body.model_dump().items():
            setattr(row, k, v)
    else:
        row = JobDecision(user_id=user.id, **body.model_dump())
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Job).filter_by(id=job_id, user_id=user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "job not found"})
    return row


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    row = db.query(Job).filter_by(id=job_id, user_id=user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "job not found"})
    db.delete(row)
    db.commit()
