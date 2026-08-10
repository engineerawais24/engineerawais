"""Regression: Bayt jobs harvested by the extension must pass the SAME filters.

Bayt is imported through the browser (the extension harvests the user's own
logged-in search page and POSTs each card to /api/jobs). Those postings used to
be stored unfiltered, so UAE roles, off-target titles and below-floor salaries
reached Today's Jobs while every backend-side import rejected them.

The gate lives in the POST route and reuses ats_import.evaluate, so there is
one copy of the rules. This test pins that, and pins that only Bayt is gated.
"""
from app.services import ats_import


def _bayt(over=None):
    """What extension/fetch-jobs.js posts for one harvested Bayt card."""
    body = {
        "source": "Bayt",
        "source_job_id": "bayt-5123456",
        "title": "Network Security Engineer",
        "company": "stc",
        "location": "Riyadh, Saudi Arabia",
        "description": "Own the network security estate.",
        "apply_url": "https://www.bayt.com/en/saudi-arabia/jobs/network-security-engineer-5123456/",
        "canonical_url": "https://www.bayt.com/en/saudi-arabia/jobs/network-security-engineer-5123456/",
    }
    body.update(over or {})
    return body


def test_bayt_jobs_are_filtered_by_the_shared_rules_before_they_are_saved(client):
    # ---- a posting that passes every rule is stored, exactly as before ----
    ok = client.post("/api/jobs", json=_bayt())
    assert ok.status_code == 201, ok.text
    assert ok.json()["title"] == "Network Security Engineer"

    # ---- each rule rejects, and nothing is stored ----
    rejected = {
        "wrong country (UAE)": _bayt({
            "source_job_id": "bayt-1", "location": "Dubai, United Arab Emirates",
            "apply_url": "https://www.bayt.com/en/uae/jobs/network-security-engineer-1/"}),
        "no country (Remote)": _bayt({
            "source_job_id": "bayt-2", "location": "Remote",
            "apply_url": "https://www.bayt.com/en/jobs/network-security-engineer-2/"}),
        "off-target title": _bayt({
            "source_job_id": "bayt-3", "title": "Customer Care Advisor",
            "apply_url": "https://www.bayt.com/en/saudi-arabia/jobs/customer-care-advisor-3/"}),
        "salary below the floor": _bayt({
            "source_job_id": "bayt-4", "description": "Salary: SAR 12,000 per month",
            "apply_url": "https://www.bayt.com/en/saudi-arabia/jobs/network-security-engineer-4/"}),
    }
    for why, payload in rejected.items():
        r = client.post("/api/jobs", json=payload)
        assert r.status_code == 422, "%s should be rejected, got %s" % (why, r.status_code)
        assert r.json()["error"]["code"] == "filtered", why

    # ---- an undisclosed salary is KEPT (silence is not a rejection) ----
    unknown = client.post("/api/jobs", json=_bayt({
        "source_job_id": "bayt-5", "title": "Solutions Architect",
        "description": "No pay stated.",
        "apply_url": "https://www.bayt.com/en/qatar/jobs/solutions-architect-5/",
        "location": "Doha, Qatar"}))
    assert unknown.status_code == 201, unknown.text

    # ---- only the two survivors are on the board ----
    stored = client.get("/api/jobs").json()
    assert len(stored) == 2
    assert {j["title"] for j in stored} == {"Network Security Engineer", "Solutions Architect"}

    # ---- other sources are NOT gated: LinkedIn and GulfTalent still save ----
    for source, sid in (("LinkedIn", "linkedin-9"), ("GulfTalent", "gulftalent-9")):
        r = client.post("/api/jobs", json=_bayt({
            "source": source, "source_job_id": sid,
            "title": "Customer Care Advisor",          # would fail the role rule
            "location": "Dubai, United Arab Emirates",  # would fail the location rule
            "apply_url": "https://example.com/%s" % sid}))
        assert r.status_code == 201, "%s must not be gated, got %s" % (source, r.text)

    # ---- and the rules themselves are the shared ones, not a second copy ----
    assert ats_import.evaluate({
        "location": "Dubai, United Arab Emirates",
        "title": "Network Security Engineer", "description": ""})["ok"] is False


def test_a_bayt_title_naming_another_country_beats_the_location_field(client):
    """Regression: Bayt filed "Firewall Engineer- Dubai, UAE" under location
    "Saudi Arabia". The location filter alone passed it, so a UAE role reached
    Today's Jobs. The title is now cross-checked and wins over the field."""
    conflicting = _bayt({
        "source_job_id": "bayt-dubai-1",
        "title": "Firewall Engineer - Dubai, UAE",
        "location": "Saudi Arabia",
        "apply_url": "https://www.bayt.com/en/saudi-arabia/jobs/firewall-engineer-dubai-uae-1/",
    })
    r = client.post("/api/jobs", json=conflicting)
    assert r.status_code == 422, "a Dubai title must be rejected, got %s" % r.text
    assert r.json()["error"]["code"] == "filtered"
    assert "Dubai" in r.json()["error"]["message"]
    assert client.get("/api/jobs").json() == []          # nothing was stored

    # the same title in-region is NOT rejected by this rule — the cross-check
    # must not over-reject. ("Firewall Engineer" is not itself a target role,
    # so the target-role title is used here to isolate the location rule.)
    assert ats_import.conflicting_location("Firewall Engineer - Riyadh") is None
    fine = _bayt({
        "source_job_id": "bayt-riyadh-1",
        "title": "Network Security Engineer - Riyadh",
        "location": "Saudi Arabia",
        "apply_url": "https://www.bayt.com/en/saudi-arabia/jobs/network-security-engineer-riyadh-1/",
    })
    assert client.post("/api/jobs", json=fine).status_code == 201
    assert len(client.get("/api/jobs").json()) == 1

    # a title naming BOTH a target country and another site is still in-region,
    # exactly as the location field rule already treats multi-site postings
    assert ats_import.conflicting_location("Solutions Architect - Dubai & Riyadh") is None
    # and the substring trap that ruled out reusing FOREIGN_RE here
    assert ats_import.conflicting_location("Security Camera Systems Engineer") is None
