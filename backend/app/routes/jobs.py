"""Job + decision routes (Sprint 16 PART 4).

Creating a job with a (source, source_job_id) that already exists
returns 409 — duplicate protection (PART 10).

Job Discovery v1 adds the second half of that rule: an EXACT `apply_url`
match is a duplicate too, so the same posting reached under two different
source ids (a portal re-issuing an id, two saved searches overlapping)
is stored once. It is deliberately the exact URL and NEVER `canonical_url`:
Oracle/SPA boards put the requisition id in the query string, so distinct
jobs share one canonical URL and merging on it links a job to the wrong
application package (the WSP-vs-Microsoft bug).

Bayt postings arrive here from the browser extension, which harvests the
user's own logged-in search page. Those jobs used to bypass the location /
role / salary rules that every backend-side import already applies, so the
gate is enforced HERE, at the save boundary — reusing `ats_import.evaluate`
rather than porting the rules into the extension's JavaScript, where they
would immediately drift. Only Bayt is gated: the other sources either filter
at import time (Greenhouse, Lever, Cisco) or are deliberately unfiltered.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Job, JobDecision, User
from ..schemas import JobIn, JobOut, JobDecisionIn, JobDecisionOut
from ..services import ats_import
from ..services.seed import current_user

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# sources whose postings must pass the shared filters before they are stored
FILTERED_SOURCES = {"bayt"}


@router.get("", response_model=list[JobOut])
def list_jobs(limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.query(Job).filter_by(user_id=user.id).order_by(Job.id.desc()).limit(limit).all()


@router.post("", response_model=JobOut, status_code=201)
def create_job(body: JobIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # the shared location / role / salary rules, applied BEFORE anything is
    # stored. Exactly the same `evaluate` the ATS and Cisco imports use — not a
    # second copy of the rules.
    if (body.source or "").strip().lower() in FILTERED_SOURCES:
        # The location field can contradict the title: Bayt filed
        # "Firewall Engineer - Dubai, UAE" under location "Saudi Arabia", and
        # the field alone let it through. A title naming a country outside
        # Saudi Arabia or Qatar wins over the field. Checked FIRST, with the
        # other location rule, so the rejection is reported as what it is.
        conflict = ats_import.conflicting_location(body.title)
        if conflict:
            raise HTTPException(status_code=422, detail={
                "code": "filtered",
                "message": (f"{body.source} job rejected by the job filters: the title names "
                            f"{conflict}, which is outside Saudi Arabia and Qatar "
                            f"(location field said '{body.location}')"),
            })

        verdict = ats_import.evaluate({
            "location": body.location,
            "title": body.title,
            "description": body.description,
        })
        if not verdict["ok"]:
            raise HTTPException(status_code=422, detail={
                "code": "filtered",
                "message": f"{body.source} job rejected by the job filters: {verdict['reason']}",
            })

    exists = db.query(Job).filter_by(user_id=user.id, source=body.source, source_job_id=body.source_job_id).first()
    if exists:
        raise HTTPException(status_code=409, detail={"code": "duplicate", "message": f"job {body.source}:{body.source_job_id} already exists"})

    apply_url = (body.apply_url or "").strip()
    if apply_url:
        same_url = db.query(Job).filter(Job.user_id == user.id, Job.apply_url == apply_url).first()
        if same_url:
            raise HTTPException(status_code=409, detail={"code": "duplicate", "message": f"job at {apply_url} already exists"})
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
