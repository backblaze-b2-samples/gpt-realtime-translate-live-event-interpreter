"""Drives the OpenAI Realtime translation sessions for a live event.

`gpt-realtime-translate` is one-output-language-per-session, so an event with N
target languages opens N upstream sessions. `EventBroadcast` fans source audio
to every session, pumps each session's translated audio + transcript to the
per-language attendee queues (plus a speaker monitor for the live caption
preview), accumulates final cues + PCM, persists on a cadence and on close, and
writes the `event.json` lifecycle. SDK access stays in `repo.openai_realtime`.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from app.config import settings
from app.repo.openai_realtime import OpenAIRealtimeSession, RealtimeChunk
from app.service.audio_archive import persist_source_audio, persist_translated_audio
from app.service.events import update_manifest
from app.service.transcripts import persist_chunks
from app.types import TranscriptChunk
from app.types.events import EventStatus

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_S = 15.0  # persist cadence; bounds transcript loss on a crash

_active: dict[str, EventBroadcast] = {}  # keyed by event id; see RELIABILITY.md


class EventBroadcast:
    """Fan-out router for a single live event."""

    def __init__(
        self,
        *,
        event_id: str,
        source_language: str,
        target_languages: list[str],
        glossary_terms: list[dict] | None = None,
        title: str | None = None,
        persist_translated_audio: bool = False,
    ):
        self.event_id = event_id
        self.source_language = source_language
        self.target_languages = list(target_languages)
        self.title = title or event_id
        self.persist_translated_audio = persist_translated_audio
        self._glossary_terms = list(glossary_terms or [])

        self._sessions: dict[str, OpenAIRealtimeSession] = {}
        self._attendees: dict[str, list[asyncio.Queue[RealtimeChunk]]] = {
            code: [] for code in self.target_languages
        }
        self._monitors: list[asyncio.Queue[RealtimeChunk]] = []
        self._pumps: list[asyncio.Task] = []
        self._flush_task: asyncio.Task | None = None

        self._finals: dict[str | None, list[TranscriptChunk]] = {  # None = source
            None: [], **{code: [] for code in self.target_languages}
        }
        self._source_pcm = bytearray()
        self._lang_pcm: dict[str, bytearray] = {c: bytearray() for c in self.target_languages}

        self._started_at = datetime.now(UTC)
        self._started_monotonic = time.monotonic()
        self._attendee_peak = 0
        self._stopped = False

    async def start(self) -> None:
        """Mark the event live and open one upstream session per language."""
        update_manifest(
            self.event_id,
            title=self.title,
            status=EventStatus.live.value,
            source_language=self.source_language,
            target_languages=self.target_languages,
            persist_translated_audio=self.persist_translated_audio,
            started_at=self._started_at.isoformat(),
        )
        try:
            for index, lang in enumerate(self.target_languages):
                session = OpenAIRealtimeSession(
                    event_id=self.event_id,
                    target_language=lang,
                    source_language=self.source_language,
                    glossary_terms=self._glossary_terms,
                    model=settings.openai_realtime_model,
                    api_key=settings.openai_api_key,
                )
                await session.connect()
                self._sessions[lang] = session  # session 0 mirrors source (dedupe)
                self._pumps.append(
                    asyncio.create_task(self._pump(lang, session, emit_source=index == 0))
                )
            self._flush_task = asyncio.create_task(self._periodic_flush())
        except Exception:
            await self._teardown()
            raise

    async def stop(self) -> None:
        """Graceful teardown: drain pumps, persist, finalize the manifest."""
        if self._stopped:
            return
        self._stopped = True
        await self._teardown()
        self._persist_transcripts()
        try:
            persist_source_audio(self.event_id, bytes(self._source_pcm))
            if self.persist_translated_audio:
                for lang, pcm in self._lang_pcm.items():
                    persist_translated_audio(self.event_id, lang, bytes(pcm))
        except Exception:
            logger.exception("Audio archival failed: event_id=%s", self.event_id)
        update_manifest(
            self.event_id,
            status=EventStatus.ended.value,
            ended_at=datetime.now(UTC).isoformat(),
            duration_ms=int((time.monotonic() - self._started_monotonic) * 1000),
            attendee_peak=self._attendee_peak,
        )

    async def _teardown(self) -> None:
        """Close sessions so pumps drain trailing finals, then await them."""
        if self._flush_task:
            self._flush_task.cancel()
            await asyncio.gather(self._flush_task, return_exceptions=True)
            self._flush_task = None
        await asyncio.gather(
            *(s.close() for s in self._sessions.values()), return_exceptions=True
        )
        for task in self._pumps:
            with contextlib.suppress(TimeoutError, asyncio.CancelledError, Exception):
                await asyncio.wait_for(asyncio.shield(task), timeout=2.0)
            task.cancel()
        await asyncio.gather(*self._pumps, return_exceptions=True)
        self._pumps = []
        self._sessions = {}

    async def push_source_audio(self, pcm_chunk: bytes) -> None:
        """Forward a source-audio chunk to every upstream session."""
        if not pcm_chunk:
            return
        room = settings.max_file_size - len(self._source_pcm)
        if room > 0:
            self._source_pcm.extend(pcm_chunk[:room])
        await asyncio.gather(
            *(s.send_audio_chunk(pcm_chunk) for s in self._sessions.values()),
            return_exceptions=True,
        )

    async def _pump(
        self, lang: str, session: OpenAIRealtimeSession, emit_source: bool
    ) -> None:
        try:
            async for chunk in session.recv_translation_chunk():
                if chunk.kind == "source" and not emit_source:
                    continue
                if chunk.is_final and chunk.kind in ("source", "transcript"):
                    self._record_final(None if chunk.kind == "source" else lang, chunk)
                if chunk.kind == "audio" and self.persist_translated_audio:
                    self._append_lang_pcm(lang, chunk.payload)
                self._dispatch(chunk)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Pump failed: event_id=%s lang=%s", self.event_id, lang)

    def _dispatch(self, chunk: RealtimeChunk) -> None:
        """Route a chunk to attendee queues and/or the speaker monitor."""
        if chunk.kind in ("audio", "transcript") and chunk.lang in self._attendees:
            for q in self._attendees[chunk.lang]:
                _offer(q, chunk)
        if chunk.kind in ("transcript", "source"):  # captions -> speaker preview
            for q in self._monitors:
                _offer(q, chunk)

    def _record_final(self, key: str | None, chunk: RealtimeChunk) -> None:
        self._finals[key].append(
            TranscriptChunk(
                event_id=self.event_id,
                lang=chunk.lang or self.source_language,
                start_ms=chunk.start_ms,
                end_ms=max(chunk.end_ms, chunk.start_ms),
                text=chunk.payload,
                is_final=True,
            )
        )

    def _append_lang_pcm(self, lang: str, b64_audio: str) -> None:
        buf = self._lang_pcm.get(lang)
        if buf is None or len(buf) >= settings.max_file_size:
            return
        with contextlib.suppress(ValueError, TypeError):
            buf.extend(base64.b64decode(b64_audio)[: settings.max_file_size - len(buf)])

    async def _periodic_flush(self) -> None:
        try:
            while not self._stopped:
                await asyncio.sleep(FLUSH_INTERVAL_S)
                self._persist_transcripts()
        except asyncio.CancelledError:
            raise

    def _persist_transcripts(self) -> None:
        for key, chunks in self._finals.items():
            if not chunks:
                continue
            try:
                persist_chunks(self.event_id, key, chunks)
            except Exception:
                logger.exception(
                    "Transcript persist failed: event_id=%s lang=%s", self.event_id, key
                )

    def attendee_queue(self, lang: str) -> asyncio.Queue[RealtimeChunk]:
        if lang not in self._attendees:
            raise ValueError(f"Language '{lang}' not configured for this event")
        q: asyncio.Queue[RealtimeChunk] = asyncio.Queue(maxsize=128)
        self._attendees[lang].append(q)
        self._attendee_peak = max(self._attendee_peak, self.attendee_count)
        return q

    def drop_attendee(self, lang: str, q: asyncio.Queue[RealtimeChunk]) -> None:
        if lang in self._attendees and q in self._attendees[lang]:
            self._attendees[lang].remove(q)

    def monitor_queue(self) -> asyncio.Queue[RealtimeChunk]:
        q: asyncio.Queue[RealtimeChunk] = asyncio.Queue(maxsize=256)
        self._monitors.append(q)
        return q

    def drop_monitor(self, q: asyncio.Queue[RealtimeChunk]) -> None:
        if q in self._monitors:
            self._monitors.remove(q)

    @property
    def attendee_count(self) -> int:
        return sum(len(qs) for qs in self._attendees.values())


def _offer(q: asyncio.Queue, item: object) -> None:
    """Non-blocking enqueue; drop the oldest item when full (freshness > completeness)."""
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        with contextlib.suppress(asyncio.QueueEmpty, asyncio.QueueFull):
            q.get_nowait()
            q.put_nowait(item)


def start_session(
    *,
    event_id: str,
    source_language: str,
    target_languages: list[str],
    glossary_terms: list[dict] | None = None,
    title: str | None = None,
    persist_translated_audio: bool = False,
) -> EventBroadcast:
    """Register a new live session and return its broadcast router."""
    if event_id in _active:
        raise RuntimeError(f"Event already live: {event_id}")
    broadcast = EventBroadcast(
        event_id=event_id,
        source_language=source_language,
        target_languages=target_languages,
        glossary_terms=glossary_terms,
        title=title,
        persist_translated_audio=persist_translated_audio,
    )
    _active[event_id] = broadcast
    return broadcast


def get_session(event_id: str) -> EventBroadcast | None:
    return _active.get(event_id)


def end_session(event_id: str) -> None:
    _active.pop(event_id, None)


async def listen_attendee(event_id: str, lang: str) -> AsyncIterator[RealtimeChunk]:
    """Async iterator for an attendee WebSocket handler."""
    broadcast = get_session(event_id)
    if broadcast is None:
        return
    queue = broadcast.attendee_queue(lang)
    try:
        while True:
            yield await queue.get()
    finally:
        broadcast.drop_attendee(lang, queue)
