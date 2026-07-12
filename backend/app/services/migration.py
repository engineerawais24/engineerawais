"""One-time local→backend migration (Sprint 16 PART 6).

Insert-only + skip-on-exists, so it is IDEMPOTENT (a second run migrates
nothing) and duplicate-safe. Provenance rows (submitted applications,
interview records) are never overwritten once present. The frontend
sends an already-flattened, snake_cased bundle; no file binaries are
ever included.
"""
from datetime import datetime

from sqlalchemy.orm import Session

from ..models import (
    Profile, Preferences, Employment, Skill, Certification,
    Job, JobDecision, ApplicationPackage, SubmittedApplication,
    InterviewRecord, Migration,
)
from ..schemas.migration import MigrationBundle


def _g(d, *keys, default=""):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d[k]
    return default


def run_migration(db: Session, user, bundle: MigrationBundle, execute: bool):
    counts: dict[str, dict[str, int]] = {}
    failures: list[dict] = []

    def item(entity, exists, build):
        c = counts.setdefault(entity, {"success": 0, "skipped": 0, "failed": 0})
        if exists:
            c["skipped"] += 1
            return
        if not execute:
            c["success"] += 1
            return
        try:
            with db.begin_nested():
                db.add(build())
            c["success"] += 1
        except Exception as e:  # noqa: BLE001 — record, never crash the whole run
            c["failed"] += 1
            failures.append({"entity": entity, "error": str(e)})

    uid = user.id
    q = db.query

    # profile (single row) — insert once, never overwritten by migration
    if bundle.profile is not None:
        p = bundle.profile
        exists = q(Profile).filter_by(user_id=uid).first() is not None
        item("profile", exists, lambda: Profile(
            user_id=uid, first_name=_g(p, "first_name"), last_name=_g(p, "last_name"),
            headline=_g(p, "headline"), summary=_g(p, "summary"), email=_g(p, "email"),
            phone=_g(p, "phone"), city=_g(p, "city"), country=_g(p, "country"),
            links=p.get("links") or {}, authorization=p.get("authorization") or {}))

    if bundle.preferences is not None:
        pr = bundle.preferences
        exists = q(Preferences).filter_by(user_id=uid).first() is not None
        item("preferences", exists, lambda: Preferences(
            user_id=uid, target_roles=_g(pr, "target_roles"), locations=_g(pr, "locations"),
            min_salary=int(pr.get("min_salary") or 0), monthly_min_sar=int(pr.get("monthly_min_sar") or 0),
            monthly_min_aed=int(pr.get("monthly_min_aed") or 0), work_mode=_g(pr, "work_mode", default="Remote"),
            outside_gcc_mode=_g(pr, "outside_gcc_mode"), job_type=_g(pr, "job_type", default="Full-time"),
            relocation=bool(pr.get("relocation"))))

    for e in bundle.employment:
        ext = _g(e, "ext_id", "id")
        exists = bool(ext) and q(Employment).filter_by(user_id=uid, ext_id=ext).first() is not None
        item("employment", exists, lambda e=e, ext=ext: Employment(
            user_id=uid, ext_id=ext, company=_g(e, "company"), title=_g(e, "title"),
            location=_g(e, "location"), start_date=_g(e, "start_date"), end_date=_g(e, "end_date"),
            is_current=bool(e.get("is_current")), highlights=_g(e, "highlights"), source=_g(e, "source", default="manual")))

    for name in bundle.skills:
        nm = str(name).strip()
        exists = q(Skill).filter_by(user_id=uid, name=nm).first() is not None
        item("skills", exists, lambda nm=nm: Skill(user_id=uid, name=nm))

    for cert in bundle.certifications:
        nm = _g(cert, "name")
        exists = bool(nm) and q(Certification).filter_by(user_id=uid, name=nm).first() is not None
        item("certifications", exists, lambda cert=cert, nm=nm: Certification(
            user_id=uid, name=nm, issuer=_g(cert, "issuer"), year=_g(cert, "year")))

    for j in bundle.jobs:
        src = _g(j, "source"); sid = _g(j, "source_job_id", "sourceJobId", "id")
        exists = q(Job).filter_by(user_id=uid, source=src, source_job_id=sid).first() is not None
        item("jobs", exists, lambda j=j, src=src, sid=sid: Job(
            user_id=uid, ext_id=_g(j, "ext_id", "id"), source=src, source_job_id=sid,
            title=_g(j, "title"), company=_g(j, "company"), location=_g(j, "location"),
            work_mode=_g(j, "work_mode"), employment_type=_g(j, "employment_type"),
            salary=str(_g(j, "salary")), salary_disclosed=bool(j.get("salary_disclosed")),
            currency=_g(j, "currency", default="USD"), description=_g(j, "description"),
            skills=j.get("skills") or [], apply_url=_g(j, "apply_url"), canonical_url=_g(j, "canonical_url"),
            posted_date=_g(j, "posted_date"), raw=j.get("raw") or {}))

    for d in bundle.decisions:
        jk = _g(d, "job_ext_id", "jobId", "id")
        exists = bool(jk) and q(JobDecision).filter_by(user_id=uid, job_ext_id=jk).first() is not None
        item("decisions", exists, lambda d=d, jk=jk: JobDecision(
            user_id=uid, job_ext_id=jk, outcome=_g(d, "outcome"), recommendation=_g(d, "recommendation"),
            confidence=_g(d, "confidence"), reasons=d.get("reasons") or []))

    for pk in bundle.packages:
        jk = _g(pk, "job_key", "jobId")
        exists = bool(jk) and q(ApplicationPackage).filter_by(user_id=uid, job_key=jk).first() is not None
        item("packages", exists, lambda pk=pk, jk=jk: ApplicationPackage(
            user_id=uid, job_key=jk, version=int(pk.get("version") or 1), status=_g(pk, "status"),
            match_score=pk.get("match_score"), resume_safety=pk.get("resume_safety"),
            resume=pk.get("resume") or {}, cover_letter=_g(pk, "cover_letter"),
            answers=pk.get("answers") or [], missing_info=pk.get("missing_info") or [],
            blockers=pk.get("blockers") or [], source_url=_g(pk, "source_url")))

    # submitted + interviews: PROVENANCE — skip if present, never overwrite
    for s in bundle.submitted:
        jk = _g(s, "job_key", "jobId")
        exists = bool(jk) and q(SubmittedApplication).filter_by(user_id=uid, job_key=jk).first() is not None
        item("submitted", exists, lambda s=s, jk=jk: SubmittedApplication(
            user_id=uid, job_key=jk, submission_id=_g(s, "submission_id", "confirmationId"),
            submitter=s.get("submitter") or {}, status=_g(s, "status", default="submitted"),
            snapshot=s.get("snapshot") or {}))

    for iv in bundle.interviews:
        jk = _g(iv, "job_key", "jobId")
        exists = bool(jk) and q(InterviewRecord).filter_by(user_id=uid, job_key=jk).first() is not None
        item("interviews", exists, lambda iv=iv, jk=jk: InterviewRecord(
            user_id=uid, job_key=jk, company=_g(iv, "company"), role=_g(iv, "role"),
            submission_id=_g(iv, "submission_id"), status=_g(iv, "status", default="submitted"),
            submitted=iv.get("submitted") or {}, interview=iv.get("interview") or {},
            recruiter_notes=_g(iv, "recruiter_notes"), follow_up_date=_g(iv, "follow_up_date"),
            notes=_g(iv, "notes"), events=iv.get("events") or [], mock=iv.get("mock") or {}))

    success = sum(c["success"] for c in counts.values())
    skipped = sum(c["skipped"] for c in counts.values())
    failed = sum(c["failed"] for c in counts.values())

    if not execute:
        return {"migration_id": 0, "status": "preview", "started_at": datetime.utcnow(),
                "finished_at": datetime.utcnow(), "success_count": success, "failed_count": failed,
                "skipped_count": skipped, "counts": counts, "failures": failures}

    mig = Migration(source="localStorage", status="completed" if failed == 0 else "partial",
                    counts=counts, success_count=success, failed_count=failed, skipped_count=skipped,
                    note=f"{success} imported, {skipped} skipped, {failed} failed")
    db.add(mig)
    db.commit()
    db.refresh(mig)
    return {"migration_id": mig.id, "status": mig.status, "started_at": mig.started_at,
            "finished_at": mig.finished_at, "success_count": success, "failed_count": failed,
            "skipped_count": skipped, "counts": counts, "failures": failures}
