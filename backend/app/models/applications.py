"""Application + interview models (Sprint 16 PART 3).

Provenance is preserved: SubmittedApplication.snapshot and
InterviewRecord.submitted are immutable JSON blobs holding the EXACT
resume version, cover letter and answers that were submitted. The API
layer never overwrites them once written.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from ..database import Base


def _now() -> datetime:
    return datetime.utcnow()


class ApplicationPackage(Base):
    """The prepared package (tailored copy, cover, answers, safety)."""
    __tablename__ = "application_packages"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_key = Column(String(120), nullable=False, index=True)   # frontend jobId
    version = Column(Integer, default=1)
    status = Column(String(48), default="")
    match_score = Column(Integer, nullable=True)
    resume_safety = Column(Integer, nullable=True)
    resume = Column(JSON, default=dict)          # label, base, plan, safety, audit …
    cover_letter = Column(Text, default="")
    answers = Column(JSON, default=list)
    missing_info = Column(JSON, default=list)
    blockers = Column(JSON, default=list)
    source_url = Column(String(1000), default="")
    created_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "job_key", name="uq_pkg_user_job"),)


class SubmittedApplication(Base):
    """An immutable record of a submitted application (provenance)."""
    __tablename__ = "submitted_applications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_key = Column(String(120), nullable=False, index=True)
    submission_id = Column(String(120), default="")     # confirmation id (MOCK-…)
    submitter = Column(JSON, default=dict)              # {id, label, method}
    status = Column(String(48), default="submitted")
    snapshot = Column(JSON, default=dict)              # EXACT resume + answers + cover (immutable)
    submitted_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "job_key", name="uq_submitted_user_job"),)


class InterviewRecord(Base):
    """Application memory for interview prep — the frozen submitted
    version plus mutable interview-tracking fields."""
    __tablename__ = "interview_records"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_key = Column(String(120), nullable=False, index=True)
    company = Column(String(255), default="")
    role = Column(String(255), default="")
    submission_id = Column(String(120), default="")
    status = Column(String(48), default="submitted")
    submitted = Column(JSON, default=dict)            # immutable: resumeDoc, cover, answers, audit
    interview = Column(JSON, default=dict)            # {date, type, interviewer, meetingLink}
    recruiter_notes = Column(Text, default="")
    follow_up_date = Column(String(16), default="")
    notes = Column(Text, default="")
    events = Column(JSON, default=list)
    mock = Column(JSON, default=dict)
    captured_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "job_key", name="uq_interview_user_job"),)
