"""Event-wide aggregates for the dashboard.

Split out of `service.events` so the per-event lifecycle code stays under
the 300-line file-size limit. Both modules share the same `EVENTS_PREFIX`
shape and `EVENT_ID_RE` validation pattern from `service.events`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.repo import (
    EVENTS_PREFIX,
    get_event_object_bytes,
    list_event_objects,
    list_event_prefixes,
)
from app.service.events import EVENT_ID_RE
from app.types import EventStatus
from app.types.formatting import humanize_bytes


def _manifest_key(event_id: str) -> str:
    return f"{EVENTS_PREFIX}{event_id}/event.json"


def get_event_aggregates() -> dict:
    """Return event-aware aggregates for the dashboard endpoint."""
    prefixes = list_event_prefixes()
    event_ids = [
        p[len(EVENTS_PREFIX) :].rstrip("/")
        for p in prefixes
        if p.startswith(EVENTS_PREFIX)
    ]
    today = datetime.now(UTC).date()
    total_size_bytes = 0
    total_duration_ms = 0
    languages: dict[str, int] = {}
    formats: dict[str, int] = {}
    live_events = 0
    events_today = 0
    attendee_peak = 0

    for eid in event_ids:
        if not EVENT_ID_RE.match(eid):
            continue
        objects = list_event_objects(eid)
        for obj in objects:
            total_size_bytes += obj["Size"]
            key = obj["Key"]
            if key.endswith(("/source.wav", "/source.ogg", "/source.opus")):
                ext = key.rsplit(".", 1)[-1]
                formats[ext] = formats.get(ext, 0) + 1
        manifest_bytes = get_event_object_bytes(_manifest_key(eid))
        if manifest_bytes is None:
            continue
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if manifest.get("status") == EventStatus.live.value:
            live_events += 1
        for code in manifest.get("target_languages") or []:
            languages[code] = languages.get(code, 0) + 1
        if manifest.get("duration_ms"):
            try:
                total_duration_ms += int(manifest["duration_ms"])
            except (TypeError, ValueError):
                pass
        peak = manifest.get("attendee_peak")
        if isinstance(peak, int) and peak > attendee_peak:
            attendee_peak = peak
        created = manifest.get("created_at")
        try:
            d = datetime.fromisoformat(str(created)).date()
            if d == today:
                events_today += 1
        except (TypeError, ValueError):
            continue

    return {
        "total_events": len(event_ids),
        "events_today": events_today,
        "live_events": live_events,
        "total_duration_ms": total_duration_ms,
        "total_size_bytes": total_size_bytes,
        "total_size_human": humanize_bytes(total_size_bytes),
        "languages": languages,
        "formats": formats,
        "attendee_peak": attendee_peak,
    }
