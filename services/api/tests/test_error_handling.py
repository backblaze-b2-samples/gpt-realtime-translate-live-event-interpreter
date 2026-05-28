"""Tests for error handling across the API."""

import pytest

from app.service import events as events_service
from app.service import files as files_service


@pytest.mark.asyncio
async def test_unhandled_exception_returns_500(client, monkeypatch):
    """Global handler catches unhandled exceptions and returns 500 JSON."""

    def explode(**kwargs):
        raise RuntimeError("B2 exploded")

    monkeypatch.setattr(files_service, "list_files", explode)

    response = await client.get("/files")
    assert response.status_code == 500
    body = response.json()
    assert body["detail"] == "Internal server error"
    # Ensure raw error message is NOT leaked to the client
    assert "B2 exploded" not in body["detail"]


@pytest.mark.asyncio
async def test_stats_b2_failure_returns_500(client, monkeypatch):
    """Stats endpoint returns 500 when B2 is unreachable."""

    def explode():
        raise RuntimeError("B2 stats query failed")

    monkeypatch.setattr(files_service, "get_event_stats", explode)

    response = await client.get("/files/stats")
    assert response.status_code == 500
    assert response.json()["detail"] == "Internal server error"


@pytest.mark.asyncio
async def test_download_not_found_returns_404(client, monkeypatch):
    """Download for a missing file returns 404 with detail."""
    monkeypatch.setattr(files_service, "get_file_metadata", lambda key: None)

    response = await client.get("/files/uploads/missing.txt/download")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_traversal_keys_are_rejected():
    """validate_key blocks empty keys and path-traversal patterns."""
    from app.service.files import FileKeyError, validate_key

    bad_keys = [
        "",
        "uploads/../secret.txt",
        "../etc/passwd",
        "uploads\\secret.txt",
        "uploads/%2e%2e/secret",
        "uploads/\x00null",
    ]
    for bad in bad_keys:
        with pytest.raises(FileKeyError):
            validate_key(bad)

    # Sanity: ordinary keys (including those outside events/) pass.
    validate_key("events/keynote-2026/source.wav")
    validate_key("uploads/file.txt")
    validate_key("readme.md")


def test_event_id_traversal_is_rejected():
    """validate_event_id blocks malformed or traversal-shaped ids."""
    from app.service.events import EventKeyError, validate_event_id

    bad_ids = [
        "",
        "too..short",  # contains ..
        "has/slash",
        "has.dot",
        "x",  # below min length 6
        "a" * 65,  # above max length 64
    ]
    for bad in bad_ids:
        with pytest.raises(EventKeyError):
            validate_event_id(bad)

    # Sanity: well-formed ids pass.
    validate_event_id("keynote-2026")
    validate_event_id("Q1_All_Hands")
    validate_event_id("a1b2c3")


@pytest.mark.asyncio
async def test_event_not_found_returns_404(client, monkeypatch):
    """GET /events/{id} for an unknown id returns 404."""
    monkeypatch.setattr(events_service, "list_event_objects", lambda eid, **_: [])

    response = await client.get("/events/keynote-2026")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_invalid_event_id_returns_400(client):
    """GET /events/{id} with a malformed id returns 400."""
    response = await client.get("/events/bad..id")
    assert response.status_code == 400
