"""Domain schemas for the CRUD routes (Sprint 16 PART 4).

`*In` models validate request bodies; `*Out` models serialize ORM rows
(from_attributes=True). Required fields drive 422 validation failures.
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Profile ----------
class ProfileIn(BaseModel):
    first_name: str = ""
    last_name: str = ""
    headline: str = ""
    summary: str = ""
    email: str = ""
    phone: str = ""
    city: str = ""
    country: str = ""
    links: dict[str, Any] = Field(default_factory=dict)
    authorization: dict[str, Any] = Field(default_factory=dict)


class ProfileOut(_Out):
    id: int
    user_id: int
    first_name: str
    last_name: str
    headline: str
    summary: str
    email: str
    phone: str
    city: str
    country: str
    links: dict[str, Any]
    authorization: dict[str, Any]
    updated_at: datetime


# ---------- Preferences ----------
class PreferencesIn(BaseModel):
    target_roles: str = ""
    locations: str = ""
    min_salary: int = 0
    monthly_min_sar: int = 0
    monthly_min_aed: int = 0
    work_mode: str = "Remote"
    outside_gcc_mode: str = ""
    job_type: str = "Full-time"
    relocation: bool = False


class PreferencesOut(_Out):
    id: int
    user_id: int
    target_roles: str
    locations: str
    min_salary: int
    monthly_min_sar: int
    monthly_min_aed: int
    work_mode: str
    outside_gcc_mode: str
    job_type: str
    relocation: bool
    updated_at: datetime


# ---------- Employment ----------
class EmploymentIn(BaseModel):
    ext_id: str = ""
    company: str = Field(min_length=1)
    title: str = ""
    location: str = ""
    start_date: str = ""
    end_date: str = ""
    is_current: bool = False
    highlights: str = ""
    source: str = "manual"


class EmploymentOut(_Out):
    id: int
    ext_id: str
    company: str
    title: str
    location: str
    start_date: str
    end_date: str
    is_current: bool
    highlights: str
    source: str


# ---------- Skill / Certification ----------
class SkillIn(BaseModel):
    name: str = Field(min_length=1)


class SkillOut(_Out):
    id: int
    name: str


class CertificationIn(BaseModel):
    name: str = Field(min_length=1)
    issuer: str = ""
    year: str = ""


class CertificationOut(_Out):
    id: int
    name: str
    issuer: str
    year: str


# ---------- Jobs ----------
class JobIn(BaseModel):
    ext_id: str = ""
    source: str = Field(min_length=1)
    source_job_id: str = Field(min_length=1)
    title: str = ""
    company: str = ""
    location: str = ""
    work_mode: str = ""
    employment_type: str = ""
    salary: str = ""
    salary_disclosed: bool = False
    currency: str = "USD"
    description: str = ""
    skills: list[str] = Field(default_factory=list)
    apply_url: str = ""
    canonical_url: str = ""
    posted_date: str = ""
    raw: dict[str, Any] = Field(default_factory=dict)


class JobOut(_Out):
    id: int
    ext_id: str
    source: str
    source_job_id: str
    title: str
    company: str
    location: str
    work_mode: str
    employment_type: str
    salary: str
    salary_disclosed: bool
    currency: str
    description: str
    skills: list[str]
    apply_url: str
    canonical_url: str
    posted_date: str
    created_at: datetime


class JobDecisionIn(BaseModel):
    job_ext_id: str = Field(min_length=1)
    outcome: str = ""
    recommendation: str = ""
    confidence: str = ""
    reasons: list[Any] = Field(default_factory=list)


class JobDecisionOut(_Out):
    id: int
    job_ext_id: str
    outcome: str
    recommendation: str
    confidence: str
    reasons: list[Any]
    created_at: datetime


# ---------- Applications ----------
class ApplicationPackageIn(BaseModel):
    job_key: str = Field(min_length=1)
    version: int = 1
    status: str = ""
    match_score: Optional[int] = None
    resume_safety: Optional[int] = None
    resume: dict[str, Any] = Field(default_factory=dict)
    cover_letter: str = ""
    answers: list[Any] = Field(default_factory=list)
    missing_info: list[Any] = Field(default_factory=list)
    blockers: list[Any] = Field(default_factory=list)
    source_url: str = ""


class ApplicationPackageOut(_Out):
    id: int
    job_key: str
    version: int
    status: str
    match_score: Optional[int]
    resume_safety: Optional[int]
    resume: dict[str, Any]
    cover_letter: str
    answers: list[Any]
    missing_info: list[Any]
    blockers: list[Any]
    source_url: str
    created_at: datetime


class SubmittedApplicationIn(BaseModel):
    job_key: str = Field(min_length=1)
    submission_id: str = ""
    submitter: dict[str, Any] = Field(default_factory=dict)
    status: str = "submitted"
    snapshot: dict[str, Any] = Field(default_factory=dict)


class SubmittedApplicationOut(_Out):
    id: int
    job_key: str
    submission_id: str
    submitter: dict[str, Any]
    status: str
    snapshot: dict[str, Any]
    submitted_at: datetime


# ---------- Interviews ----------
class InterviewRecordIn(BaseModel):
    job_key: str = Field(min_length=1)
    company: str = ""
    role: str = ""
    submission_id: str = ""
    status: str = "submitted"
    submitted: dict[str, Any] = Field(default_factory=dict)
    interview: dict[str, Any] = Field(default_factory=dict)
    recruiter_notes: str = ""
    follow_up_date: str = ""
    notes: str = ""
    events: list[Any] = Field(default_factory=list)
    mock: dict[str, Any] = Field(default_factory=dict)


class InterviewUpdateIn(BaseModel):
    """Mutable interview-tracking fields only — NEVER the submitted snapshot."""
    status: Optional[str] = None
    interview: Optional[dict[str, Any]] = None
    recruiter_notes: Optional[str] = None
    follow_up_date: Optional[str] = None
    notes: Optional[str] = None
    events: Optional[list[Any]] = None
    mock: Optional[dict[str, Any]] = None


class InterviewRecordOut(_Out):
    id: int
    job_key: str
    company: str
    role: str
    submission_id: str
    status: str
    submitted: dict[str, Any]
    interview: dict[str, Any]
    recruiter_notes: str
    follow_up_date: str
    notes: str
    events: list[Any]
    mock: dict[str, Any]
    captured_at: datetime


# ---------- Connector diagnostics ----------
class ConnectorStatusIn(BaseModel):
    connector_id: str = Field(min_length=1)
    label: str = ""
    status: str = "healthy"
    jobs_retrieved: int = 0
    retries: int = 0
    avg_response_ms: int = 0
    last_error: str = ""


class ConnectorStatusOut(_Out):
    id: int
    connector_id: str
    label: str
    status: str
    jobs_retrieved: int
    retries: int
    avg_response_ms: int
    last_error: str
    updated_at: datetime
