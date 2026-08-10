"""Import current Cisco jobs in Saudi Arabia / Qatar from Cisco's own careers site.

Source
------
careers.cisco.com (which jobs.cisco.com serves) runs on Phenom People. Its
search results are fetched by the page itself from a public JSON endpoint:

    POST https://careers.cisco.com/widgets
    {... "ddoKey": "refineSearch", "selected_fields": {"country": ["Saudi Arabia"]} ...}
    -> {"refineSearch": {"totalHits": N, "data": {"jobs": [...]}}}

That is the same call Cisco's own job search makes — no scraping, no HTML
parsing, no auth. One request per country.

Filtering
---------
Reuses the EXISTING rules in ats_import verbatim — location (Saudi Arabia or
Qatar only), the target-role list, and the salary rule (disclosed-and-below
rejects; undisclosed is kept and marked unknown). Nothing about Greenhouse or
Lever is touched; this module only borrows their filters.

Saving
------
The existing Job table, deduplicated by Cisco job id and by exact URL.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..models import Job, User
from . import ats_import
from .ats_import import (
    SALARY_UNKNOWN,
    SALARY_VERIFIED,
    _canonical,
    _iso_date,
    _plain,
)

WIDGETS_URL = "https://careers.cisco.com/widgets"
SOURCE = "Cisco"
COUNTRIES = ("Saudi Arabia", "Qatar")
PAGE_SIZE = 100

PostFn = Callable[[str, dict], Any]


def _payload(country: str, size: int = PAGE_SIZE, start: int = 0) -> dict:
    """Exactly the shape Cisco's own search-results page posts."""
    return {
        "lang": "en_global",
        "deviceType": "desktop",
        "country": "global",
        "pageName": "search-results",
        "ddoKey": "refineSearch",
        "sortBy": "",
        "subsearch": "",
        "from": start,
        "jobs": True,
        "counts": True,
        "all_fields": [],
        "size": size,
        "clientName": "cisco",
        "locationData": {},
        "keywords": "",
        "global": True,
        "selected_fields": {"country": [country]},
    }


def http_post_json(url: str, payload: dict) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": "CareerPilot/1.0 (+local)",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": "https://careers.cisco.com/global/en/search-results",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 — fixed vendor host
        return json.loads(resp.read().decode("utf-8"))


def fetch_country(country: str, post: PostFn | None = None, size: int = PAGE_SIZE) -> list[dict]:
    """Raw job records Cisco returns for one country."""
    post = post or http_post_json
    data = post(WIDGETS_URL, _payload(country, size=size))
    refine = (data or {}).get("refineSearch") or {}
    jobs = (refine.get("data") or {}).get("jobs") or []
    return [j for j in jobs if isinstance(j, dict)]


def job_url(raw: dict) -> str:
    """Where the job is applied to. Cisco routes applications through its own
    Workday tenant; that URL is the posting's stable public address."""
    url = str(raw.get("applyUrl") or "").strip()
    if url:
        return _canonical(url)
    seq = str(raw.get("jobSeqNo") or "").strip()
    if seq:
        return "https://careers.cisco.com/global/en/job/" + seq
    return ""


def normalize(raw: dict) -> dict | None:
    """One Cisco record -> the shape the importer and the filters expect."""
    title = str(raw.get("title") or "").strip()
    url = job_url(raw)
    job_id = str(raw.get("jobId") or raw.get("reqId") or "").strip()
    if not title or not url or not job_id:
        return None
    location = str(raw.get("cityStateCountry") or raw.get("location")
                   or raw.get("country") or "").strip()
    return {
        "title": title,
        "company": SOURCE,
        "location": location,
        "url": url,
        "source": SOURCE,
        "source_job_id": "cisco-%s" % job_id,
        "posted_date": _iso_date(raw.get("postedDate") or raw.get("dateCreated")),
        "description": _plain(str(raw.get("descriptionTeaser") or "")),
        "employment_type": str(raw.get("type") or "").strip(),
        "work_mode": str(raw.get("RemoteType") or "").strip(),
    }


def _existing(db: Session, user: User, job: dict) -> Job | None:
    """Deduped on the posting's own identity: the Cisco job id, then the exact
    URL. Never on a loosened URL."""
    by_id = (
        db.query(Job)
        .filter(Job.user_id == user.id,
                Job.source == job["source"],
                Job.source_job_id == job["source_job_id"])
        .first()
    )
    if by_id:
        return by_id
    url = (job.get("url") or "").strip()
    if not url:
        return None
    return db.query(Job).filter(Job.user_id == user.id, Job.apply_url == url).first()


def import_all(db: Session, user: User, post: PostFn | None = None,
               countries: tuple[str, ...] = COUNTRIES, region: bool = True) -> dict:
    """Fetch, filter and save. `region=False` skips the location/role/salary gate."""
    post = post or http_post_json
    per_country = []
    saved_rows: list[dict] = []
    total_found = total_saved = total_dup = total_failed = total_filtered = 0

    for country in countries:
        try:
            raws = fetch_country(country, post=post)
        except Exception as exc:  # noqa: BLE001 — one country must not sink the rest
            per_country.append({"country": country, "error": str(exc),
                                "found": 0, "saved": 0, "duplicate": 0, "failed": 1,
                                "filtered": 0, "fetched": 0})
            total_failed += 1
            continue

        jobs = [n for n in (normalize(r) for r in raws) if n]
        fetched = len(jobs)

        kept = []
        if region:
            for j in jobs:
                verdict = ats_import.evaluate(j)          # the EXISTING rules
                if verdict["ok"]:
                    kept.append(dict(j, _salary=verdict["salary"]))
        else:
            kept = list(jobs)
        filtered = fetched - len(kept)

        saved = dup = 0
        for job in kept:
            if _existing(db, user, job):
                dup += 1
                continue
            sal = job.get("_salary") or {}
            verified = sal.get("status") == SALARY_VERIFIED
            row = Job(
                user_id=user.id,
                source=job["source"],
                source_job_id=job["source_job_id"],
                title=job["title"],
                company=job["company"],
                location=job["location"],
                work_mode=job.get("work_mode", ""),
                employment_type=job.get("employment_type", ""),
                description=job["description"],
                apply_url=job["url"],
                canonical_url=_canonical(job["url"]),
                posted_date=job["posted_date"],
                salary=("%.0f" % sal["monthly"]) if verified else "",
                salary_disclosed=verified,
                currency=(sal.get("currency") or "USD") if verified else "USD",
                raw={"source": SOURCE, "country": country,
                     "salary_status": sal.get("status") or SALARY_UNKNOWN,
                     "salary_note": sal.get("why") or ""},
            )
            db.add(row)
            try:
                db.commit()
                db.refresh(row)
                saved += 1
                saved_rows.append({
                    "id": row.id, "source": row.source, "source_job_id": row.source_job_id,
                    "title": row.title, "company": row.company, "location": row.location,
                    "apply_url": row.apply_url, "canonical_url": row.canonical_url,
                    "salary_status": sal.get("status") or SALARY_UNKNOWN,
                    "salary": row.salary, "salary_disclosed": row.salary_disclosed,
                    "currency": row.currency,
                })
            except Exception:  # noqa: BLE001 — unique-constraint race → a duplicate
                db.rollback()
                dup += 1

        per_country.append({"country": country, "fetched": fetched, "found": len(kept),
                            "saved": saved, "duplicate": dup, "failed": 0, "filtered": filtered})
        total_found += len(kept)
        total_saved += saved
        total_dup += dup
        total_filtered += filtered

    return {
        "countries": len(countries),
        "found": total_found,
        "saved": total_saved,
        "duplicate": total_dup,
        "failed": total_failed,
        "filtered": total_filtered,
        "detail": per_country,
        "jobs": saved_rows,
    }
