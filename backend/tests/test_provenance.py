"""Application provenance + immutability (Sprint 16 PART 9, 10)."""

SNAPSHOT = {
    "job_key": "gh-1",
    "submission_id": "MOCK-GREENHOUSE-gh-1-abc",
    "submitter": {"id": "greenhouse", "label": "Greenhouse", "method": "ats_api"},
    "snapshot": {
        "resume": {"label": "Acme — tailored copy v1", "safety": 100},
        "coverLetter": "Dear Acme…",
        "answers": [{"id": "notice_period", "answer": "1 month", "supported": True}],
    },
}


def test_submitted_is_immutable_provenance(client):
    r = client.post("/api/applications/submitted", json=SNAPSHOT)
    assert r.status_code == 201
    assert r.json()["snapshot"]["resume"]["safety"] == 100

    # a second submit for the same job_key is refused — never overwritten
    again = client.post("/api/applications/submitted", json={**SNAPSHOT, "snapshot": {"resume": {"safety": 0}}})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "provenance_locked"

    # the original snapshot is intact
    got = client.get("/api/applications/submitted/gh-1").json()
    assert got["snapshot"]["resume"]["safety"] == 100


def test_interview_patch_never_touches_submitted(client):
    frozen = {"resumeDoc": {"skills": ["Terraform"]}, "answers": [{"id": "x", "answer": "y", "supported": True}]}
    r = client.post("/api/interviews", json={"job_key": "gh-1", "company": "Acme", "role": "SE", "submitted": frozen})
    assert r.status_code == 201

    patched = client.patch("/api/interviews/gh-1", json={
        "status": "interview_scheduled",
        "interview": {"date": "2026-07-20", "type": "Technical"},
        "follow_up_date": "2026-08-01",
    })
    assert patched.status_code == 200
    body = patched.json()
    assert body["status"] == "interview_scheduled"
    assert body["interview"]["date"] == "2026-07-20"
    assert body["follow_up_date"] == "2026-08-01"
    # the frozen submitted snapshot is unchanged
    assert body["submitted"] == frozen
