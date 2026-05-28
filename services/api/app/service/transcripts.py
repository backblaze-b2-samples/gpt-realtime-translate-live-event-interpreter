"""Transcript and caption accumulation + persistence.

The Realtime session yields a stream of `TranscriptChunk`s; this service
turns those into:

  - A flat `<lang>/transcript.txt` for searchable replay.
  - A `<lang>/captions.vtt` and `<lang>/captions.srt` cue list for
    player-friendly playback.

We persist on two cadences: every N final cues (so a mid-event disconnect
doesn't lose hours of content), and on `finalize_event_transcripts()` when
the speaker socket closes cleanly.

Scaffold status:
    The accumulator and VTT/SRT writers are wired but the realtime session
    drive (in `service.realtime_session`) is the stub that hasn't yet
    produced chunks. Calling `persist_chunks([])` is a safe no-op so the
    layering tests and route handlers still exercise the path.
"""

from __future__ import annotations

import logging

from app.repo import EVENTS_PREFIX, put_event_object
from app.types import CaptionCue, TranscriptChunk

logger = logging.getLogger(__name__)


def _ms_to_vtt_timestamp(ms: int) -> str:
    """`HH:MM:SS.mmm` — VTT format."""
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms_ = divmod(rem, 1_000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms_:03d}"


def _ms_to_srt_timestamp(ms: int) -> str:
    """`HH:MM:SS,mmm` — SRT format (comma instead of period)."""
    return _ms_to_vtt_timestamp(ms).replace(".", ",")


def cues_to_vtt(cues: list[CaptionCue]) -> str:
    """Serialize cues into a WebVTT document."""
    lines = ["WEBVTT", ""]
    for cue in cues:
        start = _ms_to_vtt_timestamp(cue.start_ms)
        end = _ms_to_vtt_timestamp(cue.end_ms)
        lines.append(f"{start} --> {end}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines)


def cues_to_srt(cues: list[CaptionCue]) -> str:
    """Serialize cues into a SubRip (SRT) document."""
    lines: list[str] = []
    for cue in cues:
        start = _ms_to_srt_timestamp(cue.start_ms)
        end = _ms_to_srt_timestamp(cue.end_ms)
        lines.append(str(cue.index))
        lines.append(f"{start} --> {end}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines)


def cues_to_txt(cues: list[CaptionCue]) -> str:
    """Flat transcript — one cue per line, no timestamps."""
    return "\n".join(cue.text for cue in cues)


def chunks_to_cues(chunks: list[TranscriptChunk]) -> list[CaptionCue]:
    """Turn final chunks into a stable cue list (1-indexed).

    Interim chunks (`is_final=False`) are dropped — they're for the live
    preview only. The remaining sequence is sorted by `start_ms` so a
    chunk arriving slightly out of order doesn't break the caption file.
    """
    finals = [c for c in chunks if c.is_final]
    finals.sort(key=lambda c: (c.start_ms, c.end_ms))
    return [
        CaptionCue(
            index=i + 1,
            start_ms=c.start_ms,
            end_ms=c.end_ms,
            text=c.text,
        )
        for i, c in enumerate(finals)
    ]


def persist_chunks(
    event_id: str, lang: str | None, chunks: list[TranscriptChunk]
) -> None:
    """Persist the current chunk set into B2.

    `lang=None` writes the source-language transcript / VTT under
    `events/<id>/source-transcript.{txt,vtt}`. A non-None `lang` writes the
    translated set under `events/<id>/<lang>/{transcript.txt,captions.vtt,captions.srt}`.

    Empty `chunks` is a no-op — useful for the scaffold's "open WebSocket,
    no audio yet" path so layering tests can exercise the function safely.
    """
    if not chunks:
        return
    cues = chunks_to_cues(chunks)
    if not cues:
        return

    if lang is None:
        txt_key = f"{EVENTS_PREFIX}{event_id}/source-transcript.txt"
        vtt_key = f"{EVENTS_PREFIX}{event_id}/source-transcript.vtt"
        put_event_object(txt_key, cues_to_txt(cues).encode("utf-8"), "text/plain")
        put_event_object(vtt_key, cues_to_vtt(cues).encode("utf-8"), "text/vtt")
        return

    base = f"{EVENTS_PREFIX}{event_id}/{lang}"
    put_event_object(
        f"{base}/transcript.txt", cues_to_txt(cues).encode("utf-8"), "text/plain"
    )
    put_event_object(
        f"{base}/captions.vtt", cues_to_vtt(cues).encode("utf-8"), "text/vtt"
    )
    put_event_object(
        f"{base}/captions.srt",
        cues_to_srt(cues).encode("utf-8"),
        "application/x-subrip",
    )
    logger.info(
        "Persisted transcript: event_id=%s lang=%s cues=%d", event_id, lang, len(cues)
    )
