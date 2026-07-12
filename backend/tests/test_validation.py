"""Validation failures return structured 422s (Sprint 16 PART 10)."""


def test_employment_requires_company(client):
    r = client.post("/api/employment", json={"title": "Engineer"})   # no company
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_job_requires_source_and_source_job_id(client):
    r = client.post("/api/jobs", json={"title": "SE"})               # no source / source_job_id
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["status"] == 422
    assert isinstance(body["error"]["details"], list)


def test_not_found_is_structured(client):
    r = client.get("/api/employment/9999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
