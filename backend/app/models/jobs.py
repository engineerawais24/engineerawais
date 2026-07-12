"""Job + decision models (Sprint 16 PART 3)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from ..database import Base


def _now() -> datetime:
    return datetime.utcnow()


class Job(Base):
    """A normalized job. (source, source_job_id) is unique → duplicate
    protection on import (PART 10)."""
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ext_id = Column(String(120), default="", index=True)   # frontend job.id
    source = Column(String(64), default="")
    source_job_id = Column(String(120), default="")
    title = Column(String(255), default="")
    company = Column(String(255), default="")
    location = Column(String(255), default="")
    work_mode = Column(String(32), default="")
    employment_type = Column(String(64), default="")
    salary = Column(String(64), default="")
    salary_disclosed = Column(Boolean, default=False)
    currency = Column(String(16), default="USD")
    description = Column(Text, default="")
    skills = Column(JSON, default=list)
    apply_url = Column(String(1000), default="")
    canonical_url = Column(String(1000), default="")
    posted_date = Column(String(16), default="")
    raw = Column(JSON, default=dict)              # full normalized record for fidelity
    created_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "source", "source_job_id", name="uq_job_user_src"),)


class JobDecision(Base):
    __tablename__ = "job_decisions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_ext_id = Column(String(120), default="", index=True)
    outcome = Column(String(32), default="")       # auto_approve | manual_review | reject
    recommendation = Column(String(64), default="")
    confidence = Column(String(32), default="")
    reasons = Column(JSON, default=list)
    created_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "job_ext_id", name="uq_decision_user_job"),)
