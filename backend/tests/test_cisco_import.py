"""Cisco jobs importer (careers.cisco.com public search).

The network is never touched: `cisco_import.http_post_json` is monkeypatched.
The canned records below are REAL responses captured from the live endpoint on
2026-08-10 (Cisco's Saudi Arabia results), so the normaliser is pinned against
the shape Cisco actually returns.
"""
import json

import pytest

from app.services import ats_import, cisco_import


def _job(job_id, title, city_country="Riyadh, Saudi Arabia", **over):
    """A Cisco record, trimmed to the fields the importer reads."""
    d = {
        "jobId": job_id, "reqId": job_id,
        "jobSeqNo": "CISCISGLOBAL%sEXTERNALENGLOBAL" % job_id,
        "title": title,
        "cityStateCountry": city_country,
        "location": city_country,
        "country": city_country.split(", ")[-1],
        "city": city_country.split(",")[0],
        "applyUrl": "https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh-Saudi-Arabia/%s_%s-1"
                    % (title.replace(" ", "-"), job_id),
        "postedDate": "2026-07-03T00:00:00.000+0000",
        "dateCreated": "2026-06-15T18:55:21.330+0000",
        "descriptionTeaser": "Drive technical capabilities for partners.",
        "type": "Full time", "RemoteType": "Hybrid", "category": "Sales",
    }
    d.update(over)
    return d


# what the live Saudi search returned: 5 postings, 2 of them target roles
SAUDI = [
    _job("2017334", "Partner Solutions Engineer"),
    _job("2017318", "Renewals Specialist"),
    _job("2013895", "Telco Account Executive"),
    _job("2008697", "Splunk Customer Success Engineer - KSA"),
    _job("2012553", "Senior Cybersecurity Solutions Engineer - Splunk (Saudi Arabia)"),
]
QATAR: list = []          # the live Qatar search returned 0 hits


def _post(url, payload):
    country = payload["selected_fields"]["country"][0]
    jobs = SAUDI if country == "Saudi Arabia" else QATAR
    return {"refineSearch": {"totalHits": len(jobs), "data": {"jobs": jobs}}}


# ---------- the request Cisco's own page makes ----------

def test_payload_matches_ciscos_own_search_call():
    p = cisco_import._payload("Saudi Arabia")
    assert p["ddoKey"] == "refineSearch"
    assert p["clientName"] == "cisco"
    assert p["selected_fields"] == {"country": ["Saudi Arabia"]}
    assert p["jobs"] is True and p["size"] > 0
    assert json.dumps(p)          # must be JSON-serialisable as posted


def test_fetch_country_reads_the_refine_search_envelope():
    jobs = cisco_import.fetch_country("Saudi Arabia", post=_post)
    assert len(jobs) == 5
    assert cisco_import.fetch_country("Qatar", post=_post) == []


# ---------- normalisation ----------

def test_normalize_maps_the_fields_careerpilot_stores():
    n = cisco_import.normalize(SAUDI[0])
    assert n["title"] == "Partner Solutions Engineer"
    assert n["company"] == "Cisco"
    assert n["source"] == "Cisco"
    assert n["location"] == "Riyadh, Saudi Arabia"
    assert n["source_job_id"] == "cisco-2017334"
    assert n["url"].startswith("https://cisco.wd5.myworkdayjobs.com/")
    assert "?" not in n["url"]                      # canonicalised
    assert n["posted_date"] == "2026-07-03"
    assert n["employment_type"] == "Full time"
    assert n["work_mode"] == "Hybrid"


def test_normalize_falls_back_to_the_careers_url_and_rejects_junk():
    no_apply = dict(SAUDI[0]); no_apply.pop("applyUrl")
    assert cisco_import.normalize(no_apply)["url"].startswith("https://careers.cisco.com/global/en/job/")
    assert cisco_import.normalize({"title": "x"}) is None            # no id, no url
    assert cisco_import.normalize({"jobId": "1", "applyUrl": "https://x/y"}) is None   # no title


# ---------- the existing filters are applied, not reimplemented ----------

def test_only_target_roles_in_saudi_or_qatar_are_kept(client, monkeypatch):
    monkeypatch.setattr(cisco_import, "http_post_json", _post)

    body = client.post("/api/cisco/import").json()
    assert body["countries"] == 2
    assert body["found"] == 2          # the two Solutions Engineer roles
    assert body["saved"] == 2
    assert body["duplicate"] == 0 and body["failed"] == 0
    assert body["filtered"] == 3       # Renewals, Account Executive, Customer Success

    titles = {j["title"] for j in client.get("/api/jobs").json()}
    assert titles == {
        "Partner Solutions Engineer",
        "Senior Cybersecurity Solutions Engineer - Splunk (Saudi Arabia)",
    }


def test_a_uae_posting_is_rejected_even_from_cisco(client, monkeypatch):
    """The location rule is the shared one — Cisco gets no exemption."""
    def post(url, payload):
        return {"refineSearch": {"data": {"jobs": [
            _job("9001", "Network Security Engineer", "Dubai, United Arab Emirates"),
        ]}}}
    monkeypatch.setattr(cisco_import, "http_post_json", post)
    body = client.post("/api/cisco/import").json()
    assert body["saved"] == 0 and body["found"] == 0
    assert client.get("/api/jobs").json() == []


def test_salary_rule_is_the_shared_one(client, monkeypatch):
    """Disclosed-and-below rejects; undisclosed is kept and marked unknown."""
    def post(url, payload):
        if payload["selected_fields"]["country"][0] != "Saudi Arabia":
            return {"refineSearch": {"data": {"jobs": []}}}
        return {"refineSearch": {"data": {"jobs": [
            _job("7001", "Network Security Engineer",
                 descriptionTeaser="Salary: SAR 40,000 per month"),
            _job("7002", "Security Architect",
                 descriptionTeaser="Salary: SAR 12,000 per month"),
            _job("7003", "Technical Consultant", descriptionTeaser="No pay stated."),
        ]}}}
    monkeypatch.setattr(cisco_import, "http_post_json", post)

    body = client.post("/api/cisco/import").json()
    assert body["saved"] == 2                     # the below-floor one is rejected
    rows = {r["title"]: r for r in body["jobs"]}
    assert rows["Network Security Engineer"]["salary_status"] == ats_import.SALARY_VERIFIED
    assert rows["Network Security Engineer"]["salary"] == "40000"
    assert rows["Technical Consultant"]["salary_status"] == ats_import.SALARY_UNKNOWN
    assert rows["Technical Consultant"]["salary"] == ""
    assert "Security Architect" not in rows


# ---------- dedupe ----------

def test_reimport_dedupes_by_cisco_job_id_and_exact_url(client, monkeypatch):
    monkeypatch.setattr(cisco_import, "http_post_json", _post)

    assert client.post("/api/cisco/import").json()["saved"] == 2
    again = client.post("/api/cisco/import").json()
    assert again["saved"] == 0 and again["duplicate"] == 2
    assert again["jobs"] == []
    assert len(client.get("/api/jobs").json()) == 2


def test_a_reissued_cisco_id_at_the_same_url_is_still_a_duplicate(client, monkeypatch):
    monkeypatch.setattr(cisco_import, "http_post_json", _post)
    client.post("/api/cisco/import")

    def post(url, payload):
        if payload["selected_fields"]["country"][0] != "Saudi Arabia":
            return {"refineSearch": {"data": {"jobs": []}}}
        moved = dict(SAUDI[0], jobId="9999", reqId="9999")     # new id, same applyUrl
        return {"refineSearch": {"data": {"jobs": [moved]}}}

    monkeypatch.setattr(cisco_import, "http_post_json", post)
    body = client.post("/api/cisco/import").json()
    assert body["saved"] == 0 and body["duplicate"] == 1
    assert len(client.get("/api/jobs").json()) == 2


# ---------- resilience + the board hand-off ----------

def test_one_country_failing_does_not_sink_the_other(client, monkeypatch):
    def flaky(url, payload):
        if payload["selected_fields"]["country"][0] == "Qatar":
            raise RuntimeError("boom")
        return _post(url, payload)
    monkeypatch.setattr(cisco_import, "http_post_json", flaky)

    body = client.post("/api/cisco/import").json()
    assert body["saved"] == 2               # Saudi still imported
    assert body["failed"] == 1
    assert any("error" in d for d in body["detail"])


def test_import_returns_rows_for_todays_jobs(client, monkeypatch):
    monkeypatch.setattr(cisco_import, "http_post_json", _post)
    rows = client.post("/api/cisco/import").json()["jobs"]
    assert len(rows) == 2
    for r in rows:
        assert r["id"] and r["title"] and r["apply_url"]
        assert r["source"] == "Cisco" and r["source_job_id"].startswith("cisco-")


def test_countries_endpoint_needs_no_network(client):
    body = client.get("/api/cisco/countries").json()
    assert body["source"] == "Cisco"
    assert body["countries"] == ["Saudi Arabia", "Qatar"]


def test_greenhouse_and_lever_are_untouched_by_this_module():
    """Cisco borrows the ATS filters; it must not have altered them."""
    assert ats_import.location_country("Dubai, United Arab Emirates") is None
    assert ats_import.matches_role("Network Security Engineer") is True
    assert cisco_import.SOURCE == "Cisco"
    assert "greenhouse" not in cisco_import.WIDGETS_URL.lower()
