"""Migration preview + idempotency + duplicate protection (PART 6, 10)."""

BUNDLE = {
    "profile": {"first_name": "Mohammad", "last_name": "Awais", "city": "Riyadh"},
    "preferences": {"target_roles": "Solutions Engineer", "min_salary": 120},
    "employment": [{"ext_id": "emp-1", "company": "STC", "title": "Ops Lead"}],
    "skills": ["Terraform", "Kubernetes"],
    "certifications": [{"name": "ITIL v4", "issuer": "Axelos", "year": "2022"}],
    "jobs": [{"ext_id": "gh-1", "source": "Greenhouse", "source_job_id": "GH-1", "title": "SE"}],
    "submitted": [{"job_key": "gh-1", "submission_id": "MOCK-1", "snapshot": {"resume": {"safety": 100}}}],
    "interviews": [{"job_key": "gh-1", "company": "Acme", "role": "SE"}],
}


def test_preview_does_not_write(client):
    r = client.post("/api/migrate/preview", json=BUNDLE)
    assert r.status_code == 200
    assert r.json()["total"] > 0
    # nothing was persisted by a preview
    assert client.get("/api/jobs").json() == []
    assert client.get("/api/employment").json() == []


def test_migration_is_idempotent(client):
    first = client.post("/api/migrate", json=BUNDLE)
    assert first.status_code == 200
    b1 = first.json()
    assert b1["success_count"] > 0 and b1["failed_count"] == 0
    assert b1["skipped_count"] == 0

    # data landed
    assert len(client.get("/api/jobs").json()) == 1
    assert client.get("/api/profile").json()["first_name"] == "Mohammad"
    assert len(client.get("/api/employment").json()) == 1

    # second run migrates NOTHING (all skipped) — idempotent + duplicate-safe
    second = client.post("/api/migrate", json=BUNDLE).json()
    assert second["success_count"] == 0
    assert second["skipped_count"] == b1["success_count"]
    # still exactly one of everything
    assert len(client.get("/api/jobs").json()) == 1
    assert len(client.get("/api/applications/submitted").json()) == 1


def test_migration_history_records_run(client):
    client.post("/api/migrate", json=BUNDLE)
    hist = client.get("/api/migrate/history").json()
    assert len(hist) >= 1
    assert hist[0]["success"] >= 1
