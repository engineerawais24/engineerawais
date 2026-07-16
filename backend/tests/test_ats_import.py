"""ATS import (Greenhouse + Lever public feeds).

The network is never touched: `ats_import.http_get_json` is monkeypatched
with canned payloads and the config is pointed at a temp file.
"""
import json

from app.services import ats_import

GH_PAYLOAD = {"jobs": [
    {"id": 111, "title": "Backend Engineer",
     "absolute_url": "https://boards.greenhouse.io/acme/jobs/111?gh_src=x",
     "location": {"name": "Remote"}, "updated_at": "2026-07-10T12:00:00Z",
     "content": "<p>Build &amp; ship <b>APIs</b></p>"},
    {"id": 112, "title": "Data Analyst",
     "absolute_url": "https://boards.greenhouse.io/acme/jobs/112",
     "location": {"name": "Dubai"}, "first_published": "2026-07-01T00:00:00Z", "content": ""},
]}

LV_PAYLOAD = [
    {"id": "aaa", "text": "Solutions Engineer",
     "hostedUrl": "https://jobs.lever.co/beta/aaa",
     "categories": {"location": "Riyadh", "team": "Sales"},
     "createdAt": 1_751_328_000_000, "descriptionPlain": "Own PoCs end to end."},
]


def _fake_fetch(url: str):
    if "greenhouse" in url:
        return GH_PAYLOAD
    if "lever" in url:
        return LV_PAYLOAD
    raise AssertionError(f"unexpected url {url}")


def _config(tmp_path, companies):
    p = tmp_path / "ats_sources.json"
    p.write_text(json.dumps({"companies": companies}), encoding="utf-8")
    return p


# ---------- pure normalisers ----------

def test_normalize_greenhouse():
    jobs = ats_import.normalize_greenhouse("Acme", GH_PAYLOAD)
    assert len(jobs) == 2
    j = jobs[0]
    assert j["title"] == "Backend Engineer"
    assert j["company"] == "Acme"
    assert j["location"] == "Remote"
    assert j["source"] == "Greenhouse"
    assert j["url"] == "https://boards.greenhouse.io/acme/jobs/111"   # query stripped
    assert j["posted_date"] == "2026-07-10"
    assert j["description"] == "Build & ship APIs"                    # HTML → plain
    assert j["source_job_id"] == "gh-111"
    assert jobs[1]["posted_date"] == "2026-07-01"                     # first_published used


def test_normalize_lever():
    jobs = ats_import.normalize_lever("Beta", LV_PAYLOAD)
    assert len(jobs) == 1
    j = jobs[0]
    assert j["title"] == "Solutions Engineer"
    assert j["location"] == "Riyadh"
    assert j["source"] == "Lever"
    assert j["url"] == "https://jobs.lever.co/beta/aaa"
    assert j["source_job_id"] == "lv-aaa"
    assert j["posted_date"].startswith("20") and len(j["posted_date"]) == 10  # epoch ms → date
    assert j["description"] == "Own PoCs end to end."


def test_only_enabled_companies_are_fetched(tmp_path, monkeypatch):
    cfg = _config(tmp_path, [
        {"name": "Acme", "ats": "greenhouse", "slug": "acme", "enabled": True},
        {"name": "Off", "ats": "lever", "slug": "off", "enabled": False},
    ])
    monkeypatch.setattr(ats_import, "CONFIG_PATH", cfg)
    assert [c["name"] for c in ats_import.enabled_companies()] == ["Acme"]


# ---------- endpoint: import + dedupe ----------

def test_ats_import_endpoint_saves_and_dedupes(client, tmp_path, monkeypatch):
    cfg = _config(tmp_path, [
        {"name": "Acme", "ats": "greenhouse", "slug": "acme", "enabled": True},
        {"name": "Beta", "ats": "lever", "slug": "beta", "enabled": True},
        {"name": "Gamma", "ats": "greenhouse", "slug": "gamma", "enabled": False},
    ])
    monkeypatch.setattr(ats_import, "CONFIG_PATH", cfg)
    monkeypatch.setattr(ats_import, "http_get_json", _fake_fetch)

    r = client.post("/api/ats/import")
    assert r.status_code == 200
    body = r.json()
    assert body["companies"] == 2          # disabled Gamma not fetched
    assert body["imported"] == 3           # 2 Greenhouse + 1 Lever
    assert body["skipped"] == 0 and body["failed"] == 0

    jobs = client.get("/api/jobs").json()
    assert len(jobs) == 3
    assert {j["source"] for j in jobs} == {"Greenhouse", "Lever"}
    be = next(j for j in jobs if j["title"] == "Backend Engineer")
    assert be["apply_url"] == "https://boards.greenhouse.io/acme/jobs/111"
    assert be["company"] == "Acme"
    assert "Build & ship APIs" in be["description"]

    # re-import the same feeds → every job deduped by URL, none added
    again = client.post("/api/ats/import").json()
    assert again["imported"] == 0
    assert again["skipped"] == 3
    assert len(client.get("/api/jobs").json()) == 3


def test_ats_import_no_enabled_companies(client, tmp_path, monkeypatch):
    cfg = _config(tmp_path, [{"name": "Off", "ats": "lever", "slug": "off", "enabled": False}])
    monkeypatch.setattr(ats_import, "CONFIG_PATH", cfg)
    monkeypatch.setattr(ats_import, "http_get_json", _fake_fetch)

    body = client.post("/api/ats/import").json()
    assert body["companies"] == 0 and body["imported"] == 0
    assert client.get("/api/jobs").json() == []


def test_one_bad_feed_does_not_sink_the_rest(client, tmp_path, monkeypatch):
    cfg = _config(tmp_path, [
        {"name": "Acme", "ats": "greenhouse", "slug": "acme", "enabled": True},
        {"name": "Broken", "ats": "lever", "slug": "broken", "enabled": True},
    ])

    def flaky(url: str):
        if "lever" in url:
            raise RuntimeError("boom")
        return GH_PAYLOAD

    monkeypatch.setattr(ats_import, "CONFIG_PATH", cfg)
    monkeypatch.setattr(ats_import, "http_get_json", flaky)

    body = client.post("/api/ats/import").json()
    assert body["imported"] == 2           # Greenhouse still imported
    assert body["failed"] == 1             # Lever failure recorded, not fatal
    assert any("error" in d for d in body["detail"])


def test_sources_endpoint_lists_config_without_network(client, tmp_path, monkeypatch):
    cfg = _config(tmp_path, [{"name": "Acme", "ats": "greenhouse", "slug": "acme", "enabled": False}])
    monkeypatch.setattr(ats_import, "CONFIG_PATH", cfg)
    body = client.get("/api/ats/sources").json()
    assert body["companies"][0]["name"] == "Acme"
    assert body["companies"][0]["enabled"] is False
