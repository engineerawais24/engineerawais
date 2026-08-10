"""Job Discovery v1 — the backend half of "Fetch Jobs Now".

The fetch runs in the user's own Chrome (the extension opens each saved
search, reads the visible cards) and saves every job through the EXISTING
POST /api/jobs. No endpoint was added for it, so these tests pin the exact
behaviour the run depends on:

  * the payload the harvester sends is accepted as-is
  * DEDUP BY SOURCE JOB ID — the same (source, source_job_id) is 409
  * DEDUP BY EXACT JOB URL — the same apply_url is 409 even under a
    different source_job_id (a portal re-issuing an id, or two saved
    searches overlapping)
  * two postings that differ only in the QUERY STRING are NOT merged —
    canonical_url is never a dedup key (the WSP-vs-Microsoft bug)
  * everything saved comes back on GET /api/jobs, which is how the jobs
    reach Today's Jobs
"""


def _fetched(source: str, job_id: str, title: str, company: str, url: str, **over):
    """Exactly what extension/fetch-jobs.js payloadFor() sends."""
    body = {
        "source": source,
        "source_job_id": f"{source.lower()}-{job_id}",
        "title": title,
        "company": company,
        "location": "Dubai, United Arab Emirates",
        "apply_url": url,
        "canonical_url": url.split("?")[0].split("#")[0],
        "posted_date": "2026-08-02",
        "raw": {"detectedBy": f"JobFetch/{source}"},
    }
    body.update(over)
    return body


LI = _fetched("LinkedIn", "4021", "Senior Solutions Engineer", "Careem",
              "https://www.linkedin.com/jobs/view/4021/")
# Bayt postings are gated by the shared location/role/salary rules (see
# test_bayt_filter.py), so this fixture is an in-region target role — otherwise
# these cases would be testing the filter instead of the save contract.
BAYT = _fetched("Bayt", "5123456", "Network Security Engineer", "stc",
                "https://www.bayt.com/en/saudi-arabia/jobs/network-security-engineer-5123456/",
                location="Riyadh, Saudi Arabia")
GT = _fetched("GulfTalent", "778899", "Platform Engineer", "Majid Al Futtaim",
              "https://www.gulftalent.com/uae/jobs/platform-engineer-778899")


def test_one_fetch_saves_every_portal(client):
    """A run over all three portals stores each job once."""
    for job in (LI, BAYT, GT):
        assert client.post("/api/jobs", json=job).status_code == 201

    saved = client.get("/api/jobs").json()
    assert len(saved) == 3
    assert {j["source"] for j in saved} == {"LinkedIn", "Bayt", "GulfTalent"}
    # every field Today's Jobs needs survived the round trip
    li = [j for j in saved if j["source"] == "LinkedIn"][0]
    assert li["title"] == "Senior Solutions Engineer"
    assert li["company"] == "Careem"
    assert li["location"] == "Dubai, United Arab Emirates"
    assert li["apply_url"] == "https://www.linkedin.com/jobs/view/4021/"
    assert li["source_job_id"] == "linkedin-4021"


def test_same_source_job_id_is_a_duplicate(client):
    """Re-running the same saved search adds nothing (dedup key 1)."""
    assert client.post("/api/jobs", json=LI).status_code == 201
    dup = client.post("/api/jobs", json=LI)
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate"
    assert len(client.get("/api/jobs").json()) == 1


def test_same_exact_url_under_a_different_id_is_a_duplicate(client):
    """Dedup key 2: the exact job URL, even when the portal hands out a new id."""
    assert client.post("/api/jobs", json=LI).status_code == 201

    renamed = dict(LI, source_job_id="linkedin-4021-reissued")
    dup = client.post("/api/jobs", json=renamed)
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "duplicate"
    assert len(client.get("/api/jobs").json()) == 1


def test_same_url_from_a_different_portal_is_a_duplicate(client):
    """Two saved searches surfacing one posting store it once, not twice."""
    assert client.post("/api/jobs", json=BAYT).status_code == 201

    cross = dict(BAYT, source="GulfTalent", source_job_id="gulftalent-999")
    assert client.post("/api/jobs", json=cross).status_code == 409
    assert len(client.get("/api/jobs").json()) == 1


def test_distinct_urls_all_save(client):
    """Different postings on one portal are all kept — dedup is not over-eager."""
    batch = [
        _fetched("Bayt", "1", "Network Engineer", "Acme",
                 "https://www.bayt.com/en/saudi-arabia/jobs/network-engineer-1/",
                 location="Riyadh, Saudi Arabia"),
        _fetched("Bayt", "2", "Security Architect", "Acme",
                 "https://www.bayt.com/en/saudi-arabia/jobs/security-architect-2/",
                 location="Jeddah, Saudi Arabia"),
        _fetched("Bayt", "3", "Solutions Architect", "Acme",
                 "https://www.bayt.com/en/qatar/jobs/solutions-architect-3/",
                 location="Doha, Qatar"),
    ]
    for job in batch:
        assert client.post("/api/jobs", json=job).status_code == 201
    assert len(client.get("/api/jobs").json()) == 3


def test_query_string_only_difference_is_not_merged(client):
    """canonical_url is NEVER a dedup key. Oracle/SPA boards put the requisition
    id in the query string, so two DIFFERENT jobs share one canonical URL —
    merging on it linked a job to the wrong package once already."""
    base = "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/candidateApplication"
    a = _fetched("LinkedIn", "a", "Technical Consultant", "Microsoft", f"{base}?requisitionId=1000")
    b = _fetched("LinkedIn", "b", "Work Summary", "WSP", f"{base}?requisitionId=2000")

    assert client.post("/api/jobs", json=a).status_code == 201
    assert client.post("/api/jobs", json=b).status_code == 201

    saved = client.get("/api/jobs").json()
    assert len(saved) == 2
    assert {j["company"] for j in saved} == {"Microsoft", "WSP"}
    # they DO share a canonical URL — proving the dedup ran on the exact URL
    assert len({j["canonical_url"] for j in saved}) == 1


def test_a_job_without_a_url_does_not_collide(client):
    """An empty apply_url must not make every url-less job a duplicate."""
    a = dict(LI, apply_url="", canonical_url="", source_job_id="linkedin-no-url-a")
    b = dict(LI, apply_url="", canonical_url="", source_job_id="linkedin-no-url-b")
    assert client.post("/api/jobs", json=a).status_code == 201
    assert client.post("/api/jobs", json=b).status_code == 201
    assert len(client.get("/api/jobs").json()) == 2


def test_fetched_jobs_are_listed_for_todays_jobs(client):
    """The read path: JobsBackendSync pulls GET /api/jobs straight after a run,
    which is what makes fetched jobs appear in Today's Jobs immediately."""
    for job in (LI, BAYT, GT):
        client.post("/api/jobs", json=job)

    listed = client.get("/api/jobs").json()
    for job in (LI, BAYT, GT):
        match = [j for j in listed if j["apply_url"] == job["apply_url"]]
        assert match, f"{job['source']} job must be listed back"
        assert match[0]["title"] and match[0]["company"]
