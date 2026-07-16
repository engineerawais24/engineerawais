"""Import jobs from public ATS job feeds (Greenhouse, Lever).

These are the vendors' OWN public JSON board APIs — no auth, no scraping,
no HTML parsing:

    Greenhouse:  https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
    Lever:       https://api.lever.co/v0/postings/<slug>?mode=json

Companies to import are listed in `backend/ats_sources.json`; only the ones
with `enabled: true` are fetched. Each posting is normalised to the fields
CareerPilot stores and saved as a Job, de-duplicated by job URL.

The network call is injectable (`fetch=`), so tests never touch the network.
"""
from __future__ import annotations

import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..models import Job, User

CONFIG_PATH = Path(__file__).resolve().parents[2] / "ats_sources.json"

GREENHOUSE_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
LEVER_URL = "https://api.lever.co/v0/postings/{slug}?mode=json"

FetchFn = Callable[[str], Any]


# ---------- config ----------

def load_config(path: Path | None = None) -> list[dict]:
    p = path or CONFIG_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [c for c in data.get("companies", []) if isinstance(c, dict)]


def enabled_companies(path: Path | None = None) -> list[dict]:
    return [c for c in load_config(path) if c.get("enabled") is True]


# ---------- fetch ----------

def http_get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "CareerPilot/1.0 (+local)"})
    with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310 — fixed vendor hosts
        return json.loads(resp.read().decode("utf-8"))


# ---------- normalise ----------

_TAG = re.compile(r"<[^>]+>")


def _plain(text: str, limit: int = 4000) -> str:
    """HTML/entity → plain text. The feeds ship description as HTML."""
    if not text:
        return ""
    t = _TAG.sub(" ", text)
    t = html.unescape(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def _canonical(url: str) -> str:
    return (url or "").split("?")[0].split("#")[0].rstrip("/")


def _iso_date(value: Any) -> str:
    """ISO string or epoch ms → 'YYYY-MM-DD'; '' when unknown."""
    if not value:
        return ""
    if isinstance(value, (int, float)):  # Lever: epoch milliseconds
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        except (ValueError, OSError, OverflowError):
            return ""
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(value))
    return m.group(1) if m else ""


def normalize_greenhouse(company: str, payload: dict) -> list[dict]:
    out = []
    for j in (payload or {}).get("jobs", []) or []:
        url = _canonical(j.get("absolute_url", ""))
        if not url or not j.get("title"):
            continue
        loc = (j.get("location") or {}).get("name", "") if isinstance(j.get("location"), dict) else ""
        out.append({
            "title": str(j.get("title", "")).strip(),
            "company": company,
            "location": (loc or "").strip(),
            "url": url,
            "source": "Greenhouse",
            "source_job_id": f"gh-{j.get('id', '')}" or url,
            "posted_date": _iso_date(j.get("first_published") or j.get("updated_at")),
            "description": _plain(j.get("content", "")),
        })
    return out


def normalize_lever(company: str, payload: list) -> list[dict]:
    out = []
    for j in payload or []:
        url = _canonical(j.get("hostedUrl", "") or j.get("applyUrl", ""))
        if not url or not j.get("text"):
            continue
        cats = j.get("categories") or {}
        out.append({
            "title": str(j.get("text", "")).strip(),
            "company": company,
            "location": str(cats.get("location", "") or "").strip(),
            "url": url,
            "source": "Lever",
            "source_job_id": f"lv-{j.get('id', '')}" or url,
            "posted_date": _iso_date(j.get("createdAt")),
            "description": _plain(j.get("descriptionPlain") or j.get("description", "")),
        })
    return out


def fetch_company(entry: dict, fetch: FetchFn | None = None) -> list[dict]:
    fetch = fetch or http_get_json          # resolved at call time (tests can patch)
    ats = str(entry.get("ats", "")).lower()
    slug = str(entry.get("slug", "")).strip()
    company = str(entry.get("name", "")).strip() or slug
    if not slug:
        return []
    if ats == "greenhouse":
        return normalize_greenhouse(company, fetch(GREENHOUSE_URL.format(slug=slug)))
    if ats == "lever":
        return normalize_lever(company, fetch(LEVER_URL.format(slug=slug)))
    raise ValueError(f"unknown ats '{ats}' for {company}")


# ---------- import (dedupe by URL) ----------

def import_all(db: Session, user: User, fetch: FetchFn | None = None,
               path: Path | None = None) -> dict:
    fetch = fetch or http_get_json          # resolved at call time (tests can patch)
    companies = enabled_companies(path)
    per_company = []
    total_imported = total_skipped = total_failed = 0

    for entry in companies:
        name = entry.get("name", entry.get("slug", "?"))
        try:
            jobs = fetch_company(entry, fetch=fetch)
        except Exception as exc:  # noqa: BLE001 — one bad feed must not fail the rest
            per_company.append({"company": name, "error": str(exc), "imported": 0, "skipped": 0})
            total_failed += 1
            continue

        imported = skipped = 0
        for job in jobs:
            canon = job["url"]
            exists = (
                db.query(Job)
                .filter(Job.user_id == user.id, Job.canonical_url == canon)
                .first()
            )
            if exists:
                skipped += 1                       # dedupe by job URL
                continue
            db.add(Job(
                user_id=user.id,
                source=job["source"],
                source_job_id=job["source_job_id"],
                title=job["title"],
                company=job["company"],
                location=job["location"],
                description=job["description"],
                apply_url=job["url"],
                canonical_url=canon,
                posted_date=job["posted_date"],
                raw={"ats": entry.get("ats"), "slug": entry.get("slug")},
            ))
            try:
                db.commit()
                imported += 1
            except Exception:  # noqa: BLE001 — unique-constraint race → treat as dup
                db.rollback()
                skipped += 1

        per_company.append({"company": name, "imported": imported, "skipped": skipped})
        total_imported += imported
        total_skipped += skipped

    return {
        "companies": len(companies),
        "imported": total_imported,
        "skipped": total_skipped,
        "failed": total_failed,
        "detail": per_company,
    }


# ---------- CLI: `python -m app.services.ats_import` ----------

def _main() -> None:
    from ..database import SessionLocal, init_db
    from .seed import ensure_dev_user

    init_db()
    db = SessionLocal()
    try:
        user = ensure_dev_user(db)
        summary = import_all(db, user)
    finally:
        db.close()
    print(json.dumps(summary, indent=2))
    if not summary["companies"]:
        print("\nNo enabled companies. Set \"enabled\": true in backend/ats_sources.json.")


if __name__ == "__main__":
    _main()
