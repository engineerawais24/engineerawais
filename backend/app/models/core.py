"""Core profile-domain models (Sprint 16 PART 3)."""
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint,
)

from ..database import Base


def _now() -> datetime:
    return datetime.utcnow()


class User(Base):
    """Local single-user development account (no auth this sprint)."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False, default="")
    is_dev = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=_now, nullable=False)


class Profile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    first_name = Column(String(120), default="")
    last_name = Column(String(120), default="")
    headline = Column(String(255), default="")
    summary = Column(Text, default="")
    email = Column(String(255), default="")
    phone = Column(String(64), default="")
    city = Column(String(120), default="")
    country = Column(String(120), default="")
    links = Column(JSON, default=dict)            # {linkedin, github, portfolio, other}
    authorization = Column(JSON, default=dict)    # {status, authorizedIn, sponsorship}
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class Preferences(Base):
    __tablename__ = "preferences"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    target_roles = Column(String(500), default="")
    locations = Column(String(500), default="")
    min_salary = Column(Integer, default=0)
    monthly_min_sar = Column(Integer, default=0)
    monthly_min_aed = Column(Integer, default=0)
    work_mode = Column(String(64), default="Remote")
    outside_gcc_mode = Column(String(120), default="")
    job_type = Column(String(64), default="Full-time")
    relocation = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class Employment(Base):
    """Current employment + history rows (is_current flags the current one)."""
    __tablename__ = "employment"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ext_id = Column(String(64), default="")       # frontend id (emp-1…) for idempotent import
    company = Column(String(255), default="")
    title = Column(String(255), default="")
    location = Column(String(255), default="")
    start_date = Column(String(16), default="")
    end_date = Column(String(16), default="")
    is_current = Column(Boolean, default=False)
    highlights = Column(Text, default="")
    source = Column(String(32), default="manual")
    created_at = Column(DateTime, default=_now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "ext_id", name="uq_employment_user_ext"),)


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_skill_user_name"),)


class Certification(Base):
    __tablename__ = "certifications"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    issuer = Column(String(255), default="")
    year = Column(String(16), default="")

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_cert_user_name"),)


class ResumeMeta(Base):
    """Resume METADATA only — no binary content is stored (PART 3)."""
    __tablename__ = "resume_meta"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    label = Column(String(255), default="")
    kind = Column(String(32), default="master")    # master | tailored
    file_name = Column(String(255), default="")
    file_ref = Column(String(500), default="")     # reference/URI to the stored file, not the bytes
    size = Column(Integer, default=0)
    mime = Column(String(120), default="")
    safety_score = Column(Integer, default=None, nullable=True)
    base_note = Column(String(255), default="")
    uploaded_at = Column(DateTime, default=_now, nullable=False)
