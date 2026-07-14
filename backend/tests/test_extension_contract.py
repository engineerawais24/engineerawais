"""The Chrome extension's contract with the backend.

The extension (extension/popup.js) reuses two existing endpoints —
GET /api/profile (+preferences/+employment) for autofill and
POST /api/jobs for "Save Current Job". No endpoint was added for it,
so these tests pin the exact request/response shapes it depends on.
If a field here is renamed, the extension breaks silently — that is
what this file is for.
"""


def _extension_job_payload():
    """Exactly what popup.js sends for a job detected on LinkedIn."""
    return {
        "source": "LinkedIn",
        "source_job_id": "ext-9f3a1c2b",          # FNV hash of the canonical URL
        "title": "Senior Solutions Engineer",
        "company": "Acme",
        "location": "Dubai, United Arab Emirates",
        "apply_url": "https://www.linkedin.com/jobs/view/12345?refId=abc",
        "canonical_url": "https://www.linkedin.com/jobs/view/12345",
        "raw": {"detectedBy": "LinkedIn", "pageTitle": "Senior Solutions Engineer | Acme"},
    }


def test_save_current_job(client):
    """POST /api/jobs accepts the extension's minimal payload."""
    res = client.post("/api/jobs", json=_extension_job_payload())
    assert res.status_code == 201
    body = res.json()
    assert body["title"] == "Senior Solutions Engineer"
    assert body["source"] == "LinkedIn"
    assert body["apply_url"].endswith("refId=abc")
    # `raw` is accepted and stored but deliberately not echoed by JobOut —
    # the extension never reads it back, so nothing asserts on it here.


def test_save_same_job_twice_is_409(client):
    """The popup shows 'Already saved' on 409 — the status code matters."""
    assert client.post("/api/jobs", json=_extension_job_payload()).status_code == 201
    dup = client.post("/api/jobs", json=_extension_job_payload())
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate"
    assert len(client.get("/api/jobs").json()) == 1


def test_autofill_profile_shape(client):
    """popup.js loadProfile() reads these exact keys from the three GETs."""
    profile = client.get("/api/profile").json()
    for key in ("first_name", "last_name", "headline", "email", "phone",
                "city", "country", "links", "authorization"):
        assert key in profile, f"extension reads profile.{key}"

    prefs = client.get("/api/preferences").json()
    for key in ("min_salary", "relocation"):
        assert key in prefs, f"extension reads preferences.{key}"

    res = client.get("/api/employment")
    assert res.status_code == 200
    assert isinstance(res.json(), list)     # extension iterates employment rows


def test_autofill_reads_back_what_was_saved(client):
    """Round-trip: the values the user syncs are the values autofill uses."""
    client.put("/api/profile", json={
        "first_name": "Mohammad", "last_name": "Awais",
        "email": "user@example.com", "phone": "+971 50 000 0000",
        "city": "Dubai", "country": "United Arab Emirates",
        "links": {"linkedin": "https://linkedin.com/in/example"},
        "authorization": {"status": "Citizen", "authorizedIn": "Pakistan", "sponsorship": True},
    })
    client.post("/api/employment", json={
        "company": "Vercel", "title": "Senior Cloud Engineer",
        "start_date": "2021-03", "is_current": True,
    })

    p = client.get("/api/profile").json()
    assert p["first_name"] == "Mohammad"
    assert p["links"]["linkedin"].endswith("/example")
    assert p["authorization"]["sponsorship"] is True

    rows = client.get("/api/employment").json()
    current = [r for r in rows if r["is_current"]]
    assert current and current[0]["company"] == "Vercel"
    assert current[0]["start_date"] == "2021-03"       # years-of-experience input
