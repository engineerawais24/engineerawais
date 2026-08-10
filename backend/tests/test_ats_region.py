"""Greenhouse + Lever feeds filtered to Saudi Arabia / UAE / GCC / Remote.

Every location string asserted here was taken from a REAL board response on
2026-08-03 (Careem, Tamara, Elastic, MongoDB, Binance, Palantir, and the
controls Stripe / Canonical / Remote.com), so these tests pin the filter
against the shapes the vendors actually publish rather than invented ones.
"""
import json

import pytest

from app.services import ats_import


# ---------- the region filter ----------

GCC_LOCATIONS = [
    "Dubai, United Arab Emirates",      # Careem, Palantir, Elastic
    "Abu Dhabi, United Arab Emirates",  # Palantir
    "Saudi Arabia",                     # Elastic, Tamara
    "Riyadh, Saudi Arabia",             # Tamara
    "Riyadh",                           # Tamara
    "Dubai & Sharjah",                  # Tamara
    "Dubai, Dubai, United Arab Emirates",
    "Dubai",                            # MongoDB, Stripe
    "Dubai , UAE",                      # Stripe
    "UAE, Dubai",                       # Binance
    "UAE, Abu Dhabi",                   # Binance
    "Doha, Qatar",
    "Manama, Bahrain",
    "Kuwait City, Kuwait",
    "Muscat, Oman",
    "Middle East",
]

OPEN_REMOTE = [
    "Remote",                           # Stripe, Cloudflare
    "Global",                           # Binance
    "Distributed",                      # Cloudflare
    "Hybrid or Remote",                 # Cloudflare
    "Home based - Worldwide",           # Canonical
    "Home based - EMEA",                # Canonical — EMEA contains the Gulf
    "Remote - EMEA",                    # Remote.com
    "Anywhere",
]

# remote, but pinned somewhere a Gulf-based applicant cannot take
PINNED_REMOTE = [
    "Remote - US", "Remote India", "Remote, Italy", "Remote - Canada",
    "Austria Remote", "Germany Remote", "AMER Remote", "Remote-AMER",
    "Remote-Iberia", "Remote-WesternEurope", "Remote-DACH", "Remote-NORAM",
    "Remote-Nordics", "Remote- Bulgaria", "Remote- Romania",
    "Home Based - APAC", "Home Based - Americas",
    "SF, NYC, remote", "Chicago, IL , Remote", "NYC, SF, SEA, CHI, Remote",
    "New York, San Francisco or Remote",
    "Home based - EMEA; Office Based - London, UK",
]

ELSEWHERE = [
    "Karachi, Pakistan", "Amman, Jordan", "Cairo, Egypt", "India",
    "London, United Kingdom", "Palo Alto, CA", "New York, NY", "Bengaluru",
    "Dublin, Ireland", "Taiwan, Taipei", "Kuala Lumpur", "Beijing, China",
    "In-Office", "Hybrid", "",
]


@pytest.mark.parametrize("loc", GCC_LOCATIONS)
def test_gcc_locations_are_kept(loc):
    assert ats_import.matches_region(loc) is True


@pytest.mark.parametrize("loc", OPEN_REMOTE)
def test_open_remote_is_kept(loc):
    assert ats_import.matches_region(loc) is True


@pytest.mark.parametrize("loc", PINNED_REMOTE)
def test_remote_pinned_elsewhere_is_dropped(loc):
    assert ats_import.matches_region(loc) is False


@pytest.mark.parametrize("loc", ELSEWHERE)
def test_non_gcc_locations_are_dropped(loc):
    assert ats_import.matches_region(loc) is False


def test_gcc_wins_over_a_foreign_token_in_the_same_string():
    """A multi-site posting that includes the Gulf is still a Gulf posting."""
    assert ats_import.matches_region("Dubai, London, Remote") is True
    assert ats_import.matches_region("SF, NYC, Dubai, Remote") is True


# ---------- the shipped configuration ----------

def test_shipped_sources_are_real_and_have_no_demo_entries():
    companies = ats_import.load_config()
    assert companies, "ats_sources.json must list companies"
    for c in companies:
        assert c["ats"] in ("greenhouse", "lever"), c
        assert c["slug"] and isinstance(c["slug"], str)
        assert isinstance(c["enabled"], bool)

    enabled = ats_import.enabled_companies()
    assert enabled, "at least one company must be enabled"
    names = {c["name"] for c in enabled}
    # the demo entries that used to ship here are gone for good
    assert not (names & {"Acme", "Beta", "Gamma", "Sample", "Example"})
    # both vendors are represented
    assert {c["ats"] for c in enabled} == {"greenhouse", "lever"}


# ---------- import: filtering, dedupe, counts ----------

GH = {"jobs": [
    # kept: Saudi + target role + salary above the floor
    {"id": 1, "title": "Network Security Engineer", "absolute_url": "https://boards.greenhouse.io/acme/jobs/1",
     "location": {"name": "Riyadh, Saudi Arabia"}, "content": "<p>Salary: SAR 35,000 per month</p>"},
    # kept: Saudi + target role, no salary stated -> salary unknown
    {"id": 2, "title": "Solutions Architect", "absolute_url": "https://boards.greenhouse.io/acme/jobs/2",
     "location": {"name": "Jeddah, Saudi Arabia"}, "content": "<p>Own the architecture.</p>"},
    # dropped: right place and role, salary disclosed BELOW the floor
    {"id": 3, "title": "Security Engineer", "absolute_url": "https://boards.greenhouse.io/acme/jobs/3",
     "location": {"name": "Riyadh"}, "content": "<p>Salary: SAR 18,000 per month</p>"},
    # dropped: right place, off-target title
    {"id": 4, "title": "Data Analyst II - Credit", "absolute_url": "https://boards.greenhouse.io/acme/jobs/4",
     "location": {"name": "Riyadh, Saudi Arabia"}, "content": ""},
    # dropped: target role, wrong country
    {"id": 5, "title": "Network Engineer", "absolute_url": "https://boards.greenhouse.io/acme/jobs/5",
     "location": {"name": "Dubai, United Arab Emirates"}, "content": ""},
    # dropped: target role, Remote is not a country
    {"id": 6, "title": "Infrastructure Engineer", "absolute_url": "https://boards.greenhouse.io/acme/jobs/6",
     "location": {"name": "Remote"}, "content": ""},
]}

LV = [
    # kept: Qatar + target role, salary unknown
    {"id": "x1", "text": "Technical Consultant", "hostedUrl": "https://jobs.lever.co/beta/x1",
     "categories": {"location": "Doha, Qatar"}, "descriptionPlain": "Delivery work."},
    # dropped: off-target title
    {"id": "x2", "text": "Compliance Lead", "hostedUrl": "https://jobs.lever.co/beta/x2",
     "categories": {"location": "Doha, Qatar"}, "descriptionPlain": ""},
    # dropped: wrong country
    {"id": "x3", "text": "Security Architect", "hostedUrl": "https://jobs.lever.co/beta/x3",
     "categories": {"location": "Singapore"}, "descriptionPlain": ""},
]


def _fetch(url):
    if "greenhouse" in url:
        return GH
    if "lever" in url:
        return LV
    raise AssertionError(url)


def _cfg(tmp_path):
    p = tmp_path / "ats_sources.json"
    p.write_text(json.dumps({"companies": [
        {"name": "Acme", "ats": "greenhouse", "slug": "acme", "enabled": True},
        {"name": "Beta", "ats": "lever", "slug": "beta", "enabled": True},
    ]}), encoding="utf-8")
    return p


def test_import_saves_only_target_roles_in_saudi_or_qatar(client, tmp_path, monkeypatch):
    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)

    body = client.post("/api/ats/import").json()
    # 3 of 9 pass: 2 Saudi target roles + 1 Qatar target role
    assert body["found"] == 3
    assert body["saved"] == 3
    assert body["duplicate"] == 0 and body["failed"] == 0
    assert body["filtered"] == 6      # below-floor, off-role x2, UAE, Remote, Singapore

    jobs = client.get("/api/jobs").json()
    titles = {j["title"] for j in jobs}
    assert titles == {"Network Security Engineer", "Solutions Architect", "Technical Consultant"}
    # each rejection reason is genuinely enforced
    assert "Security Engineer" not in titles          # salary below the floor
    assert "Data Analyst II - Credit" not in titles   # off-target role
    assert "Network Engineer" not in titles           # UAE
    assert "Infrastructure Engineer" not in titles    # Remote is not a country
    assert "Compliance Lead" not in titles            # off-target role
    assert "Security Architect" not in titles         # Singapore


def test_disclosed_salary_is_marked_verified_and_missing_salary_stays_unknown(client, tmp_path, monkeypatch):
    """An undisclosed salary must NOT reject the job — it is kept and labelled."""
    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)

    rows = client.post("/api/ats/import").json()["jobs"]
    by_title = {r["title"]: r for r in rows}

    verified = by_title["Network Security Engineer"]
    assert verified["salary_status"] == ats_import.SALARY_VERIFIED
    assert verified["salary_disclosed"] is True
    assert verified["salary"] == "35000" and verified["currency"] == "SAR"

    for title in ("Solutions Architect", "Technical Consultant"):
        unknown = by_title[title]
        assert unknown["salary_status"] == ats_import.SALARY_UNKNOWN
        assert unknown["salary_disclosed"] is False
        assert unknown["salary"] == ""            # never guessed


def test_import_returns_the_saved_rows_for_the_board(client, tmp_path, monkeypatch):
    """Today's Jobs shows them immediately, so the run must hand the rows back."""
    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)

    body = client.post("/api/ats/import").json()
    rows = body["jobs"]
    assert len(rows) == 3
    for r in rows:
        assert r["id"] and r["title"] and r["apply_url"]
        assert r["source"] in ("Greenhouse", "Lever")
        assert r["source_job_id"]
    gh = next(r for r in rows if r["title"] == "Network Security Engineer")
    assert gh["apply_url"] == "https://boards.greenhouse.io/acme/jobs/1"
    assert gh["company"] == "Acme"
    assert gh["location"] == "Riyadh, Saudi Arabia"


def test_reimport_is_all_duplicates_deduped_by_id_and_url(client, tmp_path, monkeypatch):
    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)

    assert client.post("/api/ats/import").json()["saved"] == 3
    again = client.post("/api/ats/import").json()
    assert again["saved"] == 0
    assert again["duplicate"] == 3
    assert again["jobs"] == []
    assert len(client.get("/api/jobs").json()) == 3


def test_dedupe_catches_a_reissued_ats_job_id_at_the_same_url(client, tmp_path, monkeypatch):
    """Same posting, new ATS id — the exact URL still identifies it."""
    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)
    client.post("/api/ats/import")

    moved = {"jobs": [dict(GH["jobs"][0], id=99)]}      # new id, same absolute_url

    def refetch(url):
        return moved if "greenhouse" in url else []

    monkeypatch.setattr(ats_import, "http_get_json", refetch)
    body = client.post("/api/ats/import").json()
    assert body["saved"] == 0 and body["duplicate"] == 1
    assert len(client.get("/api/jobs").json()) == 3


def test_region_filter_can_be_turned_off(client, tmp_path, monkeypatch):
    """The filter is a parameter, not a hard-coded rule."""
    from app.services.seed import ensure_dev_user
    from app.database import get_db
    from app.main import app as fastapi_app

    monkeypatch.setattr(ats_import, "CONFIG_PATH", _cfg(tmp_path))
    monkeypatch.setattr(ats_import, "http_get_json", _fetch)

    db = next(fastapi_app.dependency_overrides[get_db]())
    user = ensure_dev_user(db)
    summary = ats_import.import_all(db, user, region=False)
    assert summary["found"] == 9 and summary["filtered"] == 0


# ---------- role filter ----------

TARGET_TITLES = [
    "Network Security Engineer", "Senior Cyber Security Analyst", "Cybersecurity Architect",
    "Security Engineer", "Security Architect", "Network Engineer", "Network Architect",
    "Solutions Architect", "Solution Engineer", "Senior Solutions Consultant",
    "Technical Consultant", "Infrastructure Engineer", "Presales Engineer",
    "Pre-Sales Consultant", "Technical Delivery Manager", "Implementation Engineer",
    "Project Manager", "Program Manager", "Programme Manager", "Technical Project Manager",
    "PSIM Engineer", "Physical Security Manager", "Security Systems Engineer", "ICT Manager",
]

OFF_TARGET_TITLES = [
    # every one of these is a REAL title that came back from the enabled boards
    "Data Analyst II - Credit", "Customer Care Advisor (Voice)", "Fraud Investigator",
    "Engineering Manager - I", "Product Engineer II - Web", "FinOps Analyst",
    "Governance Manager", "Senior CRM & Lifecycle Specialist - B2B",
    "Team Lead - Partner Onboarding", "Senior Manager - Credit", "Application Support Engineer",
]


@pytest.mark.parametrize("title", TARGET_TITLES)
def test_target_titles_are_kept(title):
    assert ats_import.matches_role(title) is True


@pytest.mark.parametrize("title", OFF_TARGET_TITLES)
def test_off_target_titles_are_dropped(title):
    assert ats_import.matches_role(title) is False


# ---------- salary verdicts ----------

def test_undisclosed_salary_is_kept_as_unknown_never_rejected():
    r = ats_import.assess_salary("SA", "Great role. No pay information here.")
    assert r["status"] == ats_import.SALARY_UNKNOWN
    assert r["monthly"] is None            # nothing invented
    r2 = ats_import.assess_salary("SA", "Salary: competitive")
    assert r2["status"] == ats_import.SALARY_UNKNOWN


def test_disclosed_salary_at_or_above_floor_is_verified():
    for text, cur in [("Salary: SAR 35,000 per month", "SAR"),
                      ("SAR 30,000 per month", "SAR"),
                      ("Compensation: 420,000 SAR per annum", "SAR")]:
        r = ats_import.assess_salary("SA", text)
        assert r["status"] == ats_import.SALARY_VERIFIED, text
        assert r["currency"] == cur and r["monthly"] >= 30_000


def test_disclosed_salary_below_floor_is_rejected():
    r = ats_import.assess_salary("SA", "Salary: SAR 18,000 per month")
    assert r["status"] == ats_import.SALARY_BELOW
    assert ats_import.evaluate({
        "location": "Riyadh, Saudi Arabia", "title": "Security Engineer",
        "description": "Salary: SAR 18,000 per month"})["ok"] is False


def test_qatar_uses_its_own_equivalent_threshold():
    assert ats_import.assess_salary("QA", "QAR 32,000 per month")["status"] == ats_import.SALARY_VERIFIED
    assert ats_import.assess_salary("QA", "QAR 20,000 per month")["status"] == ats_import.SALARY_BELOW


def test_evaluate_applies_location_then_role_then_salary():
    ok = ats_import.evaluate({"location": "Riyadh, Saudi Arabia",
                              "title": "Network Security Engineer", "description": ""})
    assert ok["ok"] is True and ok["country"] == "SA"
    assert ok["salary"]["status"] == ats_import.SALARY_UNKNOWN

    for job, expect in [
        ({"location": "Dubai, United Arab Emirates", "title": "Network Security Engineer"}, "location"),
        ({"location": "Remote", "title": "Network Security Engineer"}, "location"),
        ({"location": "Riyadh, Saudi Arabia", "title": "Fraud Investigator"}, "title"),
    ]:
        r = ats_import.evaluate(dict(job, description=""))
        assert r["ok"] is False and expect in r["reason"]
