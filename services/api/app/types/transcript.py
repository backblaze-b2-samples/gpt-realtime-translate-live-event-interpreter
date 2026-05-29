"""Pydantic models for transcripts and captions.

Two-tier representation:
- `TranscriptChunk` is what we receive incrementally from the OpenAI
  Realtime stream (and broadcast over the attendee WebSockets).
- `CaptionCue` is the timed segment we persist into VTT / SRT files.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class TranscriptFormat(StrEnum):
    """Persisted transcript / caption formats."""

    txt = "txt"
    vtt = "vtt"
    srt = "srt"


class TranscriptChunk(BaseModel):
    """A streamed transcript chunk for an event + language.

    `start_ms` / `end_ms` are relative to the event start. `is_final` flips
    to True when the upstream model marks a segment as committed (vs. an
    interim hypothesis), at which point the chunk is eligible to be merged
    into the persisted VTT / SRT cue list.
    """

    event_id: str
    lang: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
    is_final: bool = False


class CaptionCue(BaseModel):
    """A finalized caption cue written into VTT / SRT.

    The cue list is the canonical form persisted in B2 under
    `events/<id>/<lang>/captions.{vtt,srt}` and joined into a flat transcript
    at `events/<id>/<lang>/transcript.txt`.
    """

    index: int = Field(ge=1)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    text: str
