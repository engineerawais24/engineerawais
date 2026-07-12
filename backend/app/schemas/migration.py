"""Migration schemas (Sprint 16 PART 6).

The frontend posts a bundle of its localStorage domain data. The
backend previews or imports it idempotently (existing rows are skipped,
never duplicated). Uploaded file binaries are never included.
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class MigrationBundle(BaseModel):
    profile: Optional[dict[str, Any]] = None
    preferences: Optional[dict[str, Any]] = None
    employment: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    certifications: list[dict[str, Any]] = Field(default_factory=list)
    jobs: list[dict[str, Any]] = Field(default_factory=list)
    decisions: list[dict[str, Any]] = Field(default_factory=list)
    packages: list[dict[str, Any]] = Field(default_factory=list)
    submitted: list[dict[str, Any]] = Field(default_factory=list)
    interviews: list[dict[str, Any]] = Field(default_factory=list)


class MigrationPreview(BaseModel):
    """What WOULD migrate (per entity) without writing anything."""
    entities: dict[str, int]
    total: int


class MigrationResult(BaseModel):
    migration_id: int
    status: str
    started_at: datetime
    finished_at: datetime
    success_count: int
    failed_count: int
    skipped_count: int
    counts: dict[str, dict[str, int]]
    failures: list[dict[str, Any]]
