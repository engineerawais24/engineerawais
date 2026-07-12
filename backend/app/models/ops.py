"""Operational models: connector status, sync ops, errors, migrations
(Sprint 16 PART 3)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String, Text

from ..database import Base


def _now() -> datetime:
    return datetime.utcnow()


class ConnectorStatus(Base):
    __tablename__ = "connector_status"

    id = Column(Integer, primary_key=True)
    connector_id = Column(String(64), unique=True, nullable=False, index=True)
    label = Column(String(120), default="")
    status = Column(String(48), default="healthy")
    last_run = Column(DateTime, nullable=True)
    last_success = Column(DateTime, nullable=True)
    last_error = Column(String(500), default="")
    jobs_retrieved = Column(Integer, default=0)
    retries = Column(Integer, default=0)
    avg_response_ms = Column(Integer, default=0)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class SyncOperation(Base):
    __tablename__ = "sync_operations"

    id = Column(Integer, primary_key=True)
    op_id = Column(String(64), unique=True, nullable=False, index=True)
    type = Column(String(32), default="set")
    entity = Column(String(64), default="")
    key = Column(String(255), default="")
    payload = Column(JSON, default=dict)
    status = Column(String(32), default="pending")
    attempts = Column(Integer, default=0)
    last_error = Column(String(500), default="")
    created_at = Column(DateTime, default=_now, nullable=False)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class ErrorEntry(Base):
    __tablename__ = "error_entries"

    id = Column(Integer, primary_key=True)
    error_id = Column(String(64), unique=True, nullable=False, index=True)
    category = Column(String(32), default="api")
    message = Column(Text, default="")
    source = Column(String(255), default="")
    severity = Column(String(16), default="error")
    retryable = Column(Boolean, default=False)
    resolved = Column(Boolean, default=False)
    technical = Column(JSON, default=dict)
    created_at = Column(DateTime, default=_now, nullable=False)


class KVEntry(Base):
    """Generic key/value store backing the frontend RESTStorageProvider
    (Sprint 16 PART 5). Opaque JSON blobs keyed by namespaced string."""
    __tablename__ = "kv_entries"

    id = Column(Integer, primary_key=True)
    key = Column(String(255), unique=True, nullable=False, index=True)
    value = Column(JSON, default=dict)
    updated_at = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class Migration(Base):
    """One record per migration run (PART 6)."""
    __tablename__ = "migrations"

    id = Column(Integer, primary_key=True)
    source = Column(String(64), default="localStorage")
    status = Column(String(32), default="completed")
    counts = Column(JSON, default=dict)            # {entity: {success, failed, skipped}}
    success_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    skipped_count = Column(Integer, default=0)
    note = Column(String(500), default="")
    started_at = Column(DateTime, default=_now, nullable=False)
    finished_at = Column(DateTime, default=_now, nullable=False)
