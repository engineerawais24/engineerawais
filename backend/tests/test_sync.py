"""Sprint 17 backend tests — KV scoping/batch, conflicts, diagnostics,
provenance immutability and non-destructive migration (PART 7).
"""

BUNDLE = {
    "profile": {"first_name": "Mohammad", "city": "Riyadh"},
    "jobs": [{"ext_id": "gh-1", "source": "Greenhouse", "source_job_id": "GH-1", "title": "SE"}],
    "submitted": [{"job_key": "gh-1", "submission_id": "MOCK-1", "snapshot": {"resume": {"safety": 100}}}],
}


# ---------- KV: read / write / list / delete + updated_at ----------
def test_kv_write_read_list_delete_with_metadata(client):
    r = client.put("/api/kv/careerpilot_platform.sync", json={"value": {"queue": [1]}})
    assert r.status_code == 200 and r.json()["updated_at"]

    got = client.get("/api/kv/careerpilot_platform.sync")
    assert got.status_code == 200
    body = got.json()
    assert body["value"] == {"queue": [1]} and body["updated_at"]

    listed = client.get("/api/kv", params={"prefix": "careerpilot_platform."}).json()
    assert "careerpilot_platform.sync" in listed["keys"]           # Sprint 16 shape preserved
    assert listed["entries"][0]["updated_at"]                       # Sprint 17 metadata
    assert listed["count"] == 1

    assert client.delete("/api/kv/careerpilot_platform.sync").status_code == 200
    assert client.get("/api/kv/careerpilot_platform.sync").status_code == 404


def test_kv_batch_upsert_and_delete(client):
    r = client.post("/api/kv/batch", json={
        "upserts": [{"key": "ns.a", "value": {"n": 1}}, {"key": "ns.b", "value": {"n": 2}}],
        "deletes": [],
    })
    assert r.status_code == 200 and r.json()["upserted"] == 2
    assert client.get("/api/kv/ns.a").json()["value"] == {"n": 1}

    # upsert overwrites, delete removes — in one call
    r2 = client.post("/api/kv/batch", json={
        "upserts": [{"key": "ns.a", "value": {"n": 9}}],
        "deletes": ["ns.b"],
    }).json()
    assert r2["upserted"] == 1 and r2["deleted"] == 1
    assert client.get("/api/kv/ns.a").json()["value"] == {"n": 9}
    assert client.get("/api/kv/ns.b").status_code == 404


def test_kv_batch_rejects_item_without_key(client):
    r = client.post("/api/kv/batch", json={"upserts": [{"value": {"n": 1}}], "deletes": []})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_kv_is_scoped_to_current_user(client):
    """Every KV row carries the current user's id (single-user boundary)."""
    from app.models import KVEntry, User
    from app.database import get_db
    client.put("/api/kv/scoped.key", json={"value": 1})
    db = next(client.app.dependency_overrides[get_db]())
    try:
        rows = db.query(KVEntry).all()
        users = db.query(User).all()
        assert len(rows) == 1
        assert rows[0].user_id == users[0].id     # scoped, never global
    finally:
        db.close()


# ---------- conflicts ----------
def test_conflict_record_and_list(client):
    r = client.post("/api/conflicts", json={
        "entity": "submitted", "entity_key": "gh-1", "kind": "provenance",
        "message": "backend already has a submitted snapshot",
        "local_version": {"safety": 100}, "backend_version": {"safety": 0},
    })
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "provenance" and body["resolved"] is False
    # BOTH sides retained — neither is discarded
    assert body["local_version"] == {"safety": 100}
    assert body["backend_version"] == {"safety": 0}

    listed = client.get("/api/conflicts").json()
    assert len(listed) == 1 and listed[0]["entity"] == "submitted"


def test_conflict_requires_entity(client):
    assert client.post("/api/conflicts", json={"kind": "version"}).status_code == 422


# ---------- provenance immutability (409) ----------
def test_duplicate_submitted_is_structured_409(client):
    payload = {"job_key": "gh-1", "submission_id": "MOCK-1", "snapshot": {"resume": {"safety": 100}}}
    assert client.post("/api/applications/submitted", json=payload).status_code == 201
    dup = client.post("/api/applications/submitted", json={**payload, "snapshot": {"resume": {"safety": 0}}})
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "provenance_locked"
    # original snapshot untouched
    assert client.get("/api/applications/submitted/gh-1").json()["snapshot"]["resume"]["safety"] == 100


# ---------- diagnostics ----------
def test_diagnostics_reports_counts_conflicts_and_failures(client):
    client.post("/api/migrate", json=BUNDLE)
    client.post("/api/conflicts", json={"entity": "kv", "entity_key": "x", "kind": "version", "message": "m"})
    d = client.get("/api/diagnostics").json()
    assert d["database"] == "connected"
    assert d["counts"]["jobs"] == 1
    assert d["counts"]["submitted"] == 1
    assert "kv" in d["counts"]
    assert d["conflicts"] == 1
    assert isinstance(d["recent_conflicts"], list) and d["recent_conflicts"][0]["entity"] == "kv"
    assert isinstance(d["recent_failures"], list)
    assert d["pending_sync"] >= 0


# ---------- migration remains non-destructive ----------
def test_migration_never_deletes_existing_records(client):
    client.post("/api/migrate", json=BUNDLE)
    assert len(client.get("/api/jobs").json()) == 1

    # a second migration with an EMPTY bundle must not remove anything
    empty = client.post("/api/migrate", json={}).json()
    assert empty["success_count"] == 0 and empty["failed_count"] == 0
    assert len(client.get("/api/jobs").json()) == 1
    assert len(client.get("/api/applications/submitted").json()) == 1
    assert client.get("/api/profile").json()["first_name"] == "Mohammad"
