"""CRUD + duplicate protection (Sprint 16 PART 10)."""


def test_profile_get_creates_then_put_updates(client):
    r = client.get("/api/profile")
    assert r.status_code == 200
    assert r.json()["first_name"] == ""

    r = client.put("/api/profile", json={"first_name": "Mohammad", "last_name": "Awais", "city": "Riyadh"})
    assert r.status_code == 200
    body = r.json()
    assert body["first_name"] == "Mohammad" and body["city"] == "Riyadh"

    # persisted
    assert client.get("/api/profile").json()["last_name"] == "Awais"


def test_preferences_put(client):
    r = client.put("/api/preferences", json={"target_roles": "Solutions Engineer", "min_salary": 120})
    assert r.status_code == 200
    assert r.json()["min_salary"] == 120


def test_employment_crud(client):
    r = client.post("/api/employment", json={"ext_id": "emp-1", "company": "STC", "title": "Ops Lead"})
    assert r.status_code == 201
    rid = r.json()["id"]

    assert len(client.get("/api/employment").json()) == 1
    assert client.get(f"/api/employment/{rid}").json()["company"] == "STC"

    r = client.put(f"/api/employment/{rid}", json={"ext_id": "emp-1", "company": "STC", "title": "Senior Ops Lead"})
    assert r.json()["title"] == "Senior Ops Lead"

    assert client.delete(f"/api/employment/{rid}").status_code == 204
    assert len(client.get("/api/employment").json()) == 0


def test_jobs_crud_and_duplicate_protection(client):
    payload = {"source": "Greenhouse", "source_job_id": "GH-1", "title": "SE", "company": "Acme"}
    assert client.post("/api/jobs", json=payload).status_code == 201
    # duplicate (same source + source_job_id) is rejected
    dup = client.post("/api/jobs", json=payload)
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate"
    assert len(client.get("/api/jobs").json()) == 1


def test_package_upsert(client):
    body = {"job_key": "gh-1", "status": "ready_to_apply", "match_score": 88, "resume_safety": 100}
    assert client.post("/api/applications/packages", json=body).status_code == 201
    body["status"] = "submitted"
    client.post("/api/applications/packages", json=body)
    assert client.get("/api/applications/packages/gh-1").json()["status"] == "submitted"
    assert len(client.get("/api/applications/packages").json()) == 1   # upsert, not duplicate


def test_kv_roundtrip(client):
    assert client.put("/api/kv/careerpilot_platform.sync", json={"value": {"queue": [1, 2]}}).status_code == 200
    got = client.get("/api/kv/careerpilot_platform.sync")
    assert got.status_code == 200 and got.json()["value"] == {"queue": [1, 2]}
    assert "careerpilot_platform.sync" in client.get("/api/kv", params={"prefix": "careerpilot_platform."}).json()["keys"]
    assert client.delete("/api/kv/careerpilot_platform.sync").status_code == 200
    assert client.get("/api/kv/careerpilot_platform.sync").status_code == 404
