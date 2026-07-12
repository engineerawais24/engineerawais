"""SQLAlchemy models (Sprint 16 PART 3).

Importing this package registers every table on Base.metadata so
`init_db()` can create them all. Fourteen entities are modelled:
User, Profile, Preferences, Employment, Skill, Certification,
ResumeMeta, Job, JobDecision, ApplicationPackage,
SubmittedApplication, InterviewRecord, ConnectorStatus,
SyncOperation, ErrorEntry, Migration.
"""
from .core import (
    User, Profile, Preferences, Employment, Skill, Certification, ResumeMeta,
)
from .jobs import Job, JobDecision
from .applications import ApplicationPackage, SubmittedApplication, InterviewRecord
from .ops import ConnectorStatus, SyncOperation, ErrorEntry, KVEntry, Migration

__all__ = [
    "User", "Profile", "Preferences", "Employment", "Skill", "Certification",
    "ResumeMeta", "Job", "JobDecision", "ApplicationPackage",
    "SubmittedApplication", "InterviewRecord", "ConnectorStatus",
    "SyncOperation", "ErrorEntry", "KVEntry", "Migration",
]
