"""Archive raw PCM16 capture into WAV objects in B2.

The realtime session accumulates the speaker's source PCM (and, when the event
opts in, each language's translated PCM). On close we encode those buffers into
WAV containers and persist them under the event prefix so `/events/[id]`
playback and the file explorer surface real audio.

Format: 16-bit little-endian PCM, mono, 24 kHz — the gpt-realtime-translate I/O
format (see `repo.openai_realtime`). Uses the stdlib `wave` module — no ffmpeg.
"""

from __future__ import annotations

import io
import logging
import wave

from app.repo import EVENTS_PREFIX, put_event_object

logger = logging.getLogger(__name__)

REALTIME_SAMPLE_RATE = 24_000
REALTIME_CHANNELS = 1
REALTIME_SAMPLE_WIDTH = 2  # bytes (PCM16)


def pcm16_to_wav_bytes(pcm: bytes, sample_rate: int = REALTIME_SAMPLE_RATE) -> bytes:
    """Wrap raw little-endian PCM16 mono samples in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(REALTIME_CHANNELS)
        wav.setsampwidth(REALTIME_SAMPLE_WIDTH)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()


def persist_source_audio(event_id: str, pcm: bytes) -> None:
    """Write `events/<id>/source.wav` from accumulated source PCM."""
    if not pcm:
        return
    key = f"{EVENTS_PREFIX}{event_id}/source.wav"
    put_event_object(key, pcm16_to_wav_bytes(pcm), "audio/wav")
    logger.info("Persisted source audio: event_id=%s bytes=%d", event_id, len(pcm))


def persist_translated_audio(event_id: str, lang: str, pcm: bytes) -> None:
    """Write `events/<id>/<lang>/audio.wav` from accumulated translated PCM."""
    if not pcm:
        return
    key = f"{EVENTS_PREFIX}{event_id}/{lang}/audio.wav"
    put_event_object(key, pcm16_to_wav_bytes(pcm), "audio/wav")
    logger.info(
        "Persisted translated audio: event_id=%s lang=%s bytes=%d",
        event_id,
        lang,
        len(pcm),
    )
