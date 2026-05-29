"""OpenAI Realtime *Translations* adapter — the ONLY module that talks to
OpenAI's realtime API.

Speaks the dedicated `gpt-realtime-translate` protocol over a WebSocket
(`/v1/realtime/translations`). One session == one output language; the service
layer (`service.realtime_session`) opens one session per target language and
fans the speaker's source audio to all of them.

Transport note:
    The translations endpoint has no first-class typed `openai`-SDK helper and
    uses a `session.*` event protocol distinct from the standard Realtime API,
    so we drive it with the async `websockets` client (a transitive dependency
    of `uvicorn[standard]`, pinned explicitly in `requirements.txt`). This
    module remains the single point of contact with OpenAI's realtime API —
    the containment rule (`tests/test_structure.py::test_openai_only_in_repo`)
    holds because no `openai` import exists anywhere in the tree. `websockets`
    is imported lazily inside `connect()` so `app.repo` stays importable in
    test environments that don't install it.

Protocol (per OpenAI docs, May 2026):
    - connect:  wss://api.openai.com/v1/realtime/translations?model=<model>
                header `Authorization: Bearer <key>`
    - configure: session.update -> session.audio.output.language = <bcp47>
    - input:     session.input_audio_buffer.append { audio: <b64 pcm16 24kHz> }
    - output:    session.output_audio.delta       (translated audio, b64)
                 session.output_transcript.delta  (translated text)
                 session.input_transcript.delta   (source-language text)
    - end:       session.closed
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

logger = logging.getLogger(__name__)

TRANSLATIONS_URL = "wss://api.openai.com/v1/realtime/translations"

# The streaming transcription model paired with the translate model for the
# source-language ASR mirror (`session.input_transcript.delta`).
INPUT_TRANSCRIPTION_MODEL = "gpt-realtime-whisper"

# A transcript segment is committed (is_final=True, eligible for a VTT cue)
# once the accumulated text ends on sentence-final punctuation. Covers the
# Latin set plus CJK full-width stops (U+3002 / U+FF01 / U+FF1F) for our
# default target languages. The fullwidth exclamation/question marks
# (U+FF01 / U+FF1F) are built with chr() so the source carries no
# ambiguous-character literal (ruff RUF001/RUF003).
_SENTENCE_ENDINGS = ".!?…。" + chr(0xFF01) + chr(0xFF1F)


@dataclass(frozen=True)
class RealtimeChunk:
    """A chunk emitted by the translation stream.

    `kind`:
      - "audio"      — base64 PCM16 translated audio for `lang`
      - "transcript" — translated transcript text for `lang`
      - "source"     — the source-language ASR transcript (lang is None)

    For transcript/source chunks, interim chunks (`is_final=False`) carry the
    incremental *delta* text (append client-side for a live preview); the
    committed chunk (`is_final=True`) carries the *full segment* text and is the
    one persisted into VTT/SRT cues.
    """

    kind: str
    lang: str | None
    payload: str
    start_ms: int
    end_ms: int
    is_final: bool = False


class OpenAIRealtimeSession:
    """A single upstream translation session for ONE output language."""

    def __init__(
        self,
        *,
        event_id: str,
        target_language: str,
        source_language: str | None = None,
        glossary_terms: list[dict] | None = None,
        model: str | None = None,
        api_key: str | None = None,
        safety_identifier: str | None = None,
    ):
        self.event_id = event_id
        self.target_language = target_language
        self.source_language = source_language
        # Plumbed for forward-compat; the translate model auto-detects source
        # and does not accept glossary biasing today (see tech-debt tracker).
        self.glossary_terms = list(glossary_terms or [])
        self.model = model or "gpt-realtime-translate"
        self._api_key = api_key
        self._safety_identifier = safety_identifier

        self._ws = None
        self._connected = False
        self._start_monotonic = 0.0
        # Per-stream segment accumulators, keyed by chunk kind.
        self._seg_text: dict[str, str] = {"transcript": "", "source": ""}
        self._seg_start_ms: dict[str, int] = {"transcript": 0, "source": 0}

    @property
    def connected(self) -> bool:
        return self._connected

    def _elapsed_ms(self) -> int:
        return max(0, int((time.monotonic() - self._start_monotonic) * 1000))

    async def connect(self) -> None:
        """Open the upstream session and configure the output language."""
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")

        import websockets  # lazy — keeps app.repo importable without the dep

        url = f"{TRANSLATIONS_URL}?model={self.model}"
        headers = [("Authorization", f"Bearer {self._api_key}")]
        if self._safety_identifier:
            headers.append(("OpenAI-Safety-Identifier", self._safety_identifier))

        self._ws = await websockets.connect(
            url, additional_headers=headers, max_size=None
        )
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "audio": {
                            "input": {
                                "transcription": {"model": INPUT_TRANSCRIPTION_MODEL},
                                "noise_reduction": {"type": "near_field"},
                            },
                            "output": {"language": self.target_language},
                        }
                    },
                }
            )
        )
        self._start_monotonic = time.monotonic()
        self._connected = True
        logger.info(
            "Realtime translation session open: event_id=%s target_lang=%s",
            self.event_id,
            self.target_language,
        )

    async def send_audio_chunk(self, pcm_chunk: bytes) -> None:
        """Forward a source-audio chunk (raw PCM16 @ 24 kHz) upstream."""
        if not self._connected or self._ws is None or not pcm_chunk:
            return
        payload = base64.b64encode(pcm_chunk).decode("ascii")
        await self._ws.send(
            json.dumps(
                {"type": "session.input_audio_buffer.append", "audio": payload}
            )
        )

    async def recv_translation_chunk(self) -> AsyncIterator[RealtimeChunk]:
        """Async iterator over translated audio + transcript chunks."""
        if self._ws is None:
            return

        import websockets  # lazy

        try:
            async for raw in self._ws:
                event = _loads(raw)
                etype = event.get("type")
                if etype == "session.output_audio.delta":
                    delta = event.get("delta") or ""
                    if delta:
                        now = self._elapsed_ms()
                        yield RealtimeChunk(
                            "audio", self.target_language, delta, now, now
                        )
                elif etype == "session.output_transcript.delta":
                    for chunk in self._advance_segment(
                        "transcript", self.target_language, event.get("delta") or ""
                    ):
                        yield chunk
                elif etype == "session.input_transcript.delta":
                    for chunk in self._advance_segment(
                        "source", None, event.get("delta") or ""
                    ):
                        yield chunk
                elif etype == "session.closed":
                    break
                elif etype == "error" or etype == "session.error":
                    logger.warning(
                        "Realtime session error: event_id=%s target_lang=%s detail=%s",
                        self.event_id,
                        self.target_language,
                        event.get("error") or event,
                    )
                    break
        except websockets.ConnectionClosed:
            pass

        # Natural completion: commit any trailing partial segments so the tail
        # of the talk isn't dropped from the persisted transcript.
        for chunk in self._drain_finals():
            yield chunk

    def _advance_segment(
        self, kind: str, lang: str | None, delta: str
    ) -> list[RealtimeChunk]:
        """Accumulate a transcript delta; emit an interim chunk and, at a
        sentence boundary, a committed (final) chunk for the whole segment."""
        if not delta:
            return []
        if not self._seg_text[kind]:
            self._seg_start_ms[kind] = self._elapsed_ms()
        self._seg_text[kind] += delta
        now = self._elapsed_ms()
        out = [RealtimeChunk(kind, lang, delta, self._seg_start_ms[kind], now, False)]
        if delta.rstrip().endswith(tuple(_SENTENCE_ENDINGS)):
            out.append(
                RealtimeChunk(
                    kind,
                    lang,
                    self._seg_text[kind].strip(),
                    self._seg_start_ms[kind],
                    now,
                    True,
                )
            )
            self._seg_text[kind] = ""
        return out

    def _drain_finals(self) -> list[RealtimeChunk]:
        """Commit any non-empty segment buffers as final chunks."""
        out: list[RealtimeChunk] = []
        now = self._elapsed_ms()
        for kind, lang in (("transcript", self.target_language), ("source", None)):
            text = self._seg_text.get(kind, "").strip()
            if text:
                out.append(
                    RealtimeChunk(
                        kind, lang, text, self._seg_start_ms[kind], now, True
                    )
                )
                self._seg_text[kind] = ""
        return out

    async def close(self) -> None:
        """Tear down the upstream session. Idempotent."""
        self._connected = False
        ws, self._ws = self._ws, None
        if ws is None:
            return
        with contextlib.suppress(Exception):
            await ws.send(json.dumps({"type": "session.close"}))
        with contextlib.suppress(Exception):
            await ws.close()


def _loads(raw: object) -> dict:
    """Tolerant JSON parse of a websocket frame (str or bytes)."""
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}
