"""Drives the OpenAI Realtime session per event.

Multiplexes the speaker's source-audio chunks into a single upstream
Realtime connection (wrapped in `repo.openai_realtime.OpenAIRealtimeSession`)
and fans the resulting translated streams out to per-attendee queues, keyed
by target language.

Scaffold status:
    `start_session()` raises immediately because the upstream wrapper is a
    stub. The fan-out queue machinery is real so the route handlers can
    register / unregister attendees against it without touching the repo
    layer. The structural test confirms `openai` is not imported here — all
    SDK access goes through `repo.openai_realtime`.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from app.config import settings
from app.repo.openai_realtime import OpenAIRealtimeSession, RealtimeChunk

logger = logging.getLogger(__name__)


# In-memory registry of active sessions, keyed by event id. A production
# deployment with more than one API instance needs to push this into shared
# state (Redis, Postgres LISTEN/NOTIFY, etc.) — this is documented in
# `docs/RELIABILITY.md`.
_active: dict[str, "EventBroadcast"] = {}


class EventBroadcast:
    """Fan-out router for a single live event.

    The speaker socket pushes source audio in; the upstream Realtime session
    pushes translated chunks back; this class keeps a queue per attendee
    subscription and dispatches each chunk to the queues whose language
    matches.
    """

    def __init__(
        self,
        *,
        event_id: str,
        source_language: str,
        target_languages: list[str],
        glossary_terms: list[dict] | None = None,
    ):
        self.event_id = event_id
        self.source_language = source_language
        self.target_languages = list(target_languages)
        self._session = OpenAIRealtimeSession(
            event_id=event_id,
            source_language=source_language,
            target_languages=target_languages,
            glossary_terms=glossary_terms,
            model=settings.openai_realtime_model,
            api_key=settings.openai_api_key,
        )
        # Per-language attendee queues. `dict[lang, list[Queue]]` — we list
        # rather than set because Queues aren't hashable and we want O(N)
        # broadcast over the small attendee set anyway.
        self._attendees: dict[str, list[asyncio.Queue[RealtimeChunk]]] = {
            code: [] for code in target_languages
        }

    async def start(self) -> None:
        """Open the upstream Realtime session.

        Scaffold: this raises NotImplementedError from `connect()`. The route
        handler catches the exception and closes the WebSocket with a
        structured "not yet implemented" close frame.
        """
        await self._session.connect()

    async def stop(self) -> None:
        await self._session.close()

    async def push_source_audio(self, pcm_chunk: bytes) -> None:
        await self._session.send_audio_chunk(pcm_chunk)

    def attendee_queue(self, lang: str) -> asyncio.Queue[RealtimeChunk]:
        if lang not in self._attendees:
            raise ValueError(f"Language '{lang}' not configured for this event")
        q: asyncio.Queue[RealtimeChunk] = asyncio.Queue(maxsize=64)
        self._attendees[lang].append(q)
        return q

    def drop_attendee(self, lang: str, q: asyncio.Queue[RealtimeChunk]) -> None:
        if lang in self._attendees:
            try:
                self._attendees[lang].remove(q)
            except ValueError:
                pass

    @property
    def attendee_count(self) -> int:
        return sum(len(qs) for qs in self._attendees.values())


def start_session(
    *,
    event_id: str,
    source_language: str,
    target_languages: list[str],
    glossary_terms: list[dict] | None = None,
) -> EventBroadcast:
    """Register a new live session and return its broadcast router."""
    if event_id in _active:
        raise RuntimeError(f"Event already live: {event_id}")
    broadcast = EventBroadcast(
        event_id=event_id,
        source_language=source_language,
        target_languages=target_languages,
        glossary_terms=glossary_terms,
    )
    _active[event_id] = broadcast
    return broadcast


def get_session(event_id: str) -> EventBroadcast | None:
    return _active.get(event_id)


def end_session(event_id: str) -> None:
    _active.pop(event_id, None)


async def listen_attendee(
    event_id: str, lang: str
) -> AsyncIterator[RealtimeChunk]:
    """Async iterator for an attendee WebSocket handler.

    Yields translated chunks for the requested language until the event ends
    or the attendee disconnects. Cleanly drops the attendee from the
    broadcast on iterator close.
    """
    broadcast = get_session(event_id)
    if broadcast is None:
        return
    queue = broadcast.attendee_queue(lang)
    try:
        while True:
            chunk = await queue.get()
            yield chunk
    finally:
        broadcast.drop_attendee(lang, queue)
