"""Integration tests for the events surface."""

from datetime import UTC, datetime

import pytest

from app.service import events as events_service


@pytest.mark.asyncio
async def test_list_events_empty(client, monkeypatch):
    """GET /events with no event prefixes returns an empty list."""
    monkeypatch.setattr(events_service, "list_event_prefixes", lambda **_: [])
    monkeypatch.setattr(
        events_service, "head_event_artifacts_parallel", lambda keys: {}
    )

    response = await client.get("/events")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_events_returns_manifest(client, monkeypatch):
    """GET /events surfaces event ids whose manifest exists."""
    monkeypatch.setattr(
        events_service,
        "list_event_prefixes",
        lambda **_: ["events/keynote-2026/"],
    )
    manifest_key = "events/keynote-2026/event.json"
    monkeypatch.setattr(
        events_service,
        "head_event_artifacts_parallel",
        lambda keys: {manifest_key: {"ContentLength": 100}},
    )
    manifest = {
        "id": "keynote-2026",
        "title": "Q1 Keynote",
        "status": "ended",
        "source_language": "en",
        "target_languages": ["es", "fr"],
        "persist_translated_audio": False,
        "glossary_id": None,
        "created_at": datetime.now(UTC).isoformat(),
        "attendee_peak": 0,
    }
    import json

    monkeypatch.setattr(
        events_service,
        "get_event_object_bytes",
        lambda key: json.dumps(manifest).encode("utf-8"),
    )

    response = await client.get("/events")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == "keynote-2026"
    assert body[0]["target_languages"] == ["es", "fr"]


@pytest.mark.asyncio
async def test_create_event_persists_manifest(client, monkeypatch):
    """POST /events writes an `event.json` manifest via the repo helper."""
    captured: dict[str, bytes] = {}

    def fake_put(key, body, content_type, metadata=None):
        captured[key] = body

    monkeypatch.setattr(events_service, "put_event_object", fake_put)

    response = await client.post(
        "/events",
        json={
            "id": "demo-event",
            "title": "Demo",
            "source_language": "en",
            "target_languages": ["es", "fr"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "demo-event"
    assert "events/demo-event/event.json" in captured
