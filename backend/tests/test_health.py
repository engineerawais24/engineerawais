"""Health + status + DB initialization (Sprint 16 PART 10)."""


def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["api_version"]
    assert body["service"]


def test_status_reports_db_and_counts(client):
    r = client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "connected"      # tables were created → DB initialized
    assert body["storage_provider"]
    assert body["environment"]
    assert set(["jobs", "packages", "submitted", "interviews"]).issubset(body["counts"].keys())


def test_session_is_local_dev(client):
    r = client.get("/api/session")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "local-dev"
    assert body["authenticated"] is False
    assert body["user_id"] >= 1
