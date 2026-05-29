"""Event lifecycle service.

Lists, gets, creates, and deletes live-interpretation events. The service
layer owns key validation and orchestration; raw S3 calls live in
`app.repo.b2_events`. See ARCHITECTURE.md for the storage layout.

Path-traversal payloads (`..`, `//`) are rejected before any B2 call.
Dashboard aggregates live in `service.event_stats` to keep this module
under the file-size limit.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import re
from datetime import UTC, datetime

from app.repo import (
    EVENTS_PREFIX,
    delete_event_prefix,
    get_event_object_bytes,
    head_event_artifacts_parallel,
    list_event_objects,
    list_event_prefixes,
    presign_event_download,
    presign_event_playback,
    put_event_object,
)
from app.types import Event, EventArtifact, EventCreateRequest, EventStatus
from app.types.formatting import humanize_bytes

logger = logging.getLogger(__name__)

# Event IDs are URL-safe ASCII. We deliberately disallow `/` and `.` so the
# id can't collapse into the prefix or escape into a traversal payload. The
# regex is the single source of truth — `runtime/events.py` reuses it.
EVENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")

# Language codes are BCP-47-flavored — lowercase primary subtag, optional
# region. We're lenient about the script subtag because real-world target
# lists include `zh-Hans` and `pt-BR`.
LANG_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")


class EventKeyError(Exception):
    """Raised when an event id or language code is malformed."""

    def __init__(self, detail: str = "Invalid event id"):
        self.detail = detail
        super().__init__(detail)


class EventNotFound(Exception):
    """Raised when no event exists at the requested id."""

    def __init__(self, detail: str = "Event not found"):
        self.detail = detail
        super().__init__(detail)


def validate_event_id(event_id: str) -> None:
    if not event_id or ".." in event_id or "//" in event_id or not EVENT_ID_RE.match(event_id):
        raise EventKeyError()


def validate_lang(code: str) -> None:
    if not code or not LANG_RE.match(code):
        raise EventKeyError(detail="Invalid language code")


def _kind_for_key(key: str) -> tuple[str, str | None]:
    """Classify an event artifact key into `(kind, lang)`."""
    tail = key.split("/", 2)[-1] if key.startswith(EVENTS_PREFIX) else key
    parts = tail.split("/")
    leaf = parts[-1]
    if len(parts) == 1:
        if leaf == "event.json":
            return ("manifest", None)
        if leaf.startswith("source-transcript"):
            return ("source-transcript", None)
        if leaf.startswith("source."):
            return ("source-audio", None)
        return ("other", None)
    if len(parts) == 2:
        lang = parts[0]
        if leaf.startswith("captions."):
            return ("captions", lang)
        if leaf.startswith("transcript."):
            return ("transcript", lang)
        if leaf.startswith("audio."):
            return ("translated-audio", lang)
    return ("other", None)


def _artifact_from_object(obj: dict) -> EventArtifact:
    key = obj["Key"]
    size = obj["Size"]
    kind, lang = _kind_for_key(key)
    mime, _ = mimetypes.guess_type(key)
    return EventArtifact(
        key=key,
        kind=kind,
        lang=lang,
        size_bytes=size,
        size_human=humanize_bytes(size),
        content_type=mime or "application/octet-stream",
        created_at=obj["LastModified"],
    )


def _event_from_manifest(
    event_id: str, manifest: dict, artifacts: list[EventArtifact]
) -> Event:
    return Event(
        id=event_id,
        title=manifest.get("title", event_id),
        status=EventStatus(manifest.get("status", EventStatus.scheduled.value)),
        source_language=manifest.get("source_language", "en"),
        target_languages=list(manifest.get("target_languages") or []),
        persist_translated_audio=bool(manifest.get("persist_translated_audio", False)),
        glossary_id=manifest.get("glossary_id"),
        created_at=_parse_iso(manifest.get("created_at")),
        started_at=_parse_iso(manifest.get("started_at"), allow_none=True),
        ended_at=_parse_iso(manifest.get("ended_at"), allow_none=True),
        duration_ms=manifest.get("duration_ms"),
        attendee_peak=int(manifest.get("attendee_peak", 0) or 0),
        artifacts=artifacts,
    )


def _parse_iso(value, allow_none: bool = False):
    if value is None:
        if allow_none:
            return None
        return datetime.now(UTC)
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return datetime.now(UTC) if not allow_none else None


def _manifest_key(event_id: str) -> str:
    return f"{EVENTS_PREFIX}{event_id}/event.json"


def _stub_event(event_id: str, artifacts: list[EventArtifact] | None = None) -> Event:
    """Best-effort Event for an orphan prefix (no `event.json` in B2)."""
    return Event(
        id=event_id,
        title=event_id,
        status=EventStatus.ended,
        source_language="",
        target_languages=[],
        created_at=datetime.now(UTC),
        artifacts=artifacts or [],
    )


def list_events(limit: int = 100) -> list[Event]:
    """List events, newest-first; orphan prefixes surface as stubs."""
    if limit < 1 or limit > 500:
        raise ValueError("Limit must be between 1 and 500")
    prefixes = list_event_prefixes()
    event_ids = [
        p[len(EVENTS_PREFIX) :].rstrip("/")
        for p in prefixes
        if p.startswith(EVENTS_PREFIX)
    ]
    event_ids = [eid for eid in event_ids if EVENT_ID_RE.match(eid)]
    manifest_keys = [_manifest_key(eid) for eid in event_ids]
    heads = head_event_artifacts_parallel(manifest_keys)
    out: list[Event] = []
    for eid in event_ids:
        mkey = _manifest_key(eid)
        if mkey not in heads:
            out.append(_stub_event(eid))
            continue
        body = get_event_object_bytes(mkey) or b"{}"
        try:
            manifest = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            manifest = {}
        out.append(_event_from_manifest(eid, manifest, []))
    out.sort(key=lambda e: e.created_at, reverse=True)
    return out[:limit]


def get_event(event_id: str) -> Event:
    """Return the full event detail, including artifact listing."""
    validate_event_id(event_id)
    objects = list_event_objects(event_id)
    if not objects:
        raise EventNotFound()
    artifacts = [_artifact_from_object(o) for o in objects]
    manifest_bytes = get_event_object_bytes(_manifest_key(event_id))
    if manifest_bytes is None:
        return _stub_event(event_id, artifacts=artifacts)
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        manifest = {}
    return _event_from_manifest(event_id, manifest, artifacts)


def create_event(req: EventCreateRequest) -> Event:
    """Create a new event and persist `event.json` (idempotent on the manifest)."""
    validate_event_id(req.id)
    validate_lang(req.source_language)
    for code in req.target_languages:
        validate_lang(code)
    manifest = {
        "id": req.id,
        "title": req.title,
        "status": EventStatus.scheduled.value,
        "source_language": req.source_language,
        "target_languages": req.target_languages,
        "persist_translated_audio": req.persist_translated_audio,
        "glossary_id": req.glossary_id,
        "created_at": datetime.now(UTC).isoformat(),
        "attendee_peak": 0,
    }
    put_event_object(
        _manifest_key(req.id),
        json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    return _event_from_manifest(req.id, manifest, [])


def update_manifest(event_id: str, **fields) -> dict:
    """Read-merge-write `event.json`; create it if absent.

    Lets the live session flip status (scheduled -> live -> ended) and record
    timing / attendee aggregates without a database. `None` values are skipped.
    """
    validate_event_id(event_id)
    raw = get_event_object_bytes(_manifest_key(event_id))
    manifest: dict = {}
    if raw:
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            manifest = {}
    manifest.setdefault("id", event_id)
    manifest.setdefault("created_at", datetime.now(UTC).isoformat())
    manifest.update({k: v for k, v in fields.items() if v is not None})
    put_event_object(
        _manifest_key(event_id),
        json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        "application/json",
    )
    return manifest


def delete_event(event_id: str) -> tuple[list[str], list[dict]]:
    """Cascade-delete every artifact under `events/<event-id>/`."""
    validate_event_id(event_id)
    return delete_event_prefix(event_id)


def get_source_audio_url(event_id: str) -> str:
    """Inline-playback presigned GET for the source audio artifact."""
    validate_event_id(event_id)
    candidates = [
        f"{EVENTS_PREFIX}{event_id}/source.wav",
        f"{EVENTS_PREFIX}{event_id}/source.ogg",
        f"{EVENTS_PREFIX}{event_id}/source.opus",
    ]
    objects = list_event_objects(event_id)
    keys = {o["Key"] for o in objects}
    for key in candidates:
        if key in keys:
            return presign_event_playback(key)
    raise EventNotFound(detail="Source audio not available")


def get_transcript_url(event_id: str, lang: str | None = None) -> str:
    """Attachment-style download for source or per-lang transcript."""
    validate_event_id(event_id)
    if lang is None:
        key = f"{EVENTS_PREFIX}{event_id}/source-transcript.txt"
    else:
        validate_lang(lang)
        key = f"{EVENTS_PREFIX}{event_id}/{lang}/transcript.txt"
    return presign_event_download(key, filename=key.split("/")[-1])


def get_captions_url(event_id: str, lang: str, fmt: str = "vtt") -> str:
    """Attachment-style download for per-lang captions (VTT or SRT)."""
    validate_event_id(event_id)
    validate_lang(lang)
    if fmt not in ("vtt", "srt"):
        raise EventKeyError(detail="Invalid caption format")
    key = f"{EVENTS_PREFIX}{event_id}/{lang}/captions.{fmt}"
    return presign_event_download(key, filename=key.split("/")[-1])
