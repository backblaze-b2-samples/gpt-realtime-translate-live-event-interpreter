"""Pydantic models for the live-interpretation event surface.

Events fan out under the `events/<event-id>/...` prefix in B2. Each event
collects a `event.json` manifest, the source audio, the source transcript,
plus per-language captions / transcripts / optional translated audio.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class EventStatus(StrEnum):
    """Lifecycle states for a live event.

    - `scheduled`: created but speaker hasn't started streaming yet.
    - `live`: WebSocket session is active; attendees may join.
    - `ended`: speaker disconnected (gracefully or by timeout); artifacts
      finalize and the event becomes a read-only archive.
    """

    scheduled = "scheduled"
    live = "live"
    ended = "ended"


class Language(BaseModel):
    """BCP-47-flavored language descriptor.

    We accept BCP-47 codes (`en`, `es`, `pt-BR`, `zh-Hans`) lowercased by
    convention at API boundaries. The display name is what the UI renders in
    chips, picker rows, and the attendee language selector.
    """

    code: str = Field(..., min_length=2, max_length=16)
    display_name: str = Field(..., min_length=1, max_length=64)


class EventArtifact(BaseModel):
    """A single B2 object that belongs to an event.

    Sourced from `ListObjectsV2` / `HeadObject` — no application database.
    """

    key: str
    kind: str  # "source-audio" | "source-transcript" | "captions" | "transcript" | "translated-audio" | "manifest"
    lang: str | None = None
    size_bytes: int
    size_human: str
    content_type: str
    created_at: datetime


class Event(BaseModel):
    """A live-interpretation event.

    The shape is intentionally light — B2 is the source of truth. The
    backend reconstructs an `Event` from `events/<id>/event.json` plus a
    listing of the prefix.
    """

    id: str = Field(..., min_length=6, max_length=64)
    title: str = Field(..., min_length=1, max_length=200)
    status: EventStatus
    source_language: str
    target_languages: list[str]
    persist_translated_audio: bool = False
    glossary_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_ms: int | None = None
    attendee_peak: int = 0
    artifacts: list[EventArtifact] = Field(default_factory=list)


class EventCreateRequest(BaseModel):
    """Payload for `POST /events`."""

    id: str = Field(..., min_length=6, max_length=64)
    title: str = Field(..., min_length=1, max_length=200)
    source_language: str = Field(..., min_length=2, max_length=16)
    target_languages: list[str] = Field(..., min_length=1, max_length=16)
    persist_translated_audio: bool = False
    glossary_id: str | None = None


class SpeakerSessionToken(BaseModel):
    """Short-lived token returned to the speaker page after event create.

    The speaker page presents this when opening the WebSocket so the
    backend can authorize that the connection is the legitimate speaker
    (vs. a random attendee impersonating the speaker socket).
    """

    event_id: str
    token: str
    expires_at: datetime
