"""Health / status / error / session schemas (Sprint 16 PART 2, 7)."""
from typing import Any, Optional

from pydantic import BaseModel


class HealthOut(BaseModel):
    status: str
    service: str
    api_version: str
    time: str


class StatusOut(BaseModel):
    service: str
    status: str
    database: str
    api_version: str
    environment: str
    time: str
    storage_provider: str
    counts: dict[str, int]


class ErrorOut(BaseModel):
    """Structured error envelope returned for every 4xx/5xx."""
    error: dict[str, Any]


class OkOut(BaseModel):
    ok: bool = True
    detail: Optional[str] = None


class SessionOut(BaseModel):
    mode: str
    user_id: int
    email: str
    name: str
    authenticated: bool
    note: str
