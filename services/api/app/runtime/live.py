"""WebSocket routes for the live-interpretation surface.

Two sockets per event:

  - `WS /events/{event_id}/speaker` — the speaker page pushes source audio
    chunks in. The handler hands off to `service.realtime_session` which
    drives the OpenAI Realtime upstream.
  - `WS /events/{event_id}/listen` — attendees subscribe with a `?lang=`
    query string and receive translated audio + caption chunks.

Scaffold status:
    Both handlers accept the connection, validate inputs, and immediately
    close with a structured "not yet implemented" frame because
    `service.realtime_session.EventBroadcast.start()` raises
    `NotImplementedError` from the repo stub. The route layering (no direct
    repo imports) is real and enforced by structural tests.
"""

import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.runtime.metrics import (
    record_attendee_joined,
    record_event_ended,
    record_event_started,
)
from app.service.events import EventKeyError, validate_event_id, validate_lang
from app.service.realtime_session import end_session, start_session

logger = logging.getLogger(__name__)

router = APIRouter()

# Structured close codes (4xxx range is application-level per the WS spec).
# We pick stable numbers so the frontend can branch reliably.
CLOSE_NOT_IMPLEMENTED = 4001
CLOSE_INVALID_INPUT = 4002
CLOSE_NO_EVENT = 4003


async def _close_with_reason(ws: WebSocket, code: int, reason: str) -> None:
    """Send a structured close frame the frontend can branch on."""
    try:
        await ws.send_json({"type": "close", "code": code, "reason": reason})
    except Exception:
        # If the client already vanished, just close. Logging the secondary
        # send failure adds noise without insight.
        pass
    await ws.close(code=status.WS_1011_INTERNAL_ERROR)


@router.websocket("/events/{event_id}/speaker")
async def speaker_socket(ws: WebSocket, event_id: str):
    await ws.accept()
    try:
        validate_event_id(event_id)
    except EventKeyError as e:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, e.detail)
        return

    # First frame is the session-config JSON sent by the speaker page.
    try:
        config = await ws.receive_json()
    except WebSocketDisconnect:
        return

    source_language = str(config.get("source_language", "en"))
    target_languages = [str(c) for c in config.get("target_languages", [])]

    record_event_started()
    try:
        broadcast = start_session(
            event_id=event_id,
            source_language=source_language,
            target_languages=target_languages,
            glossary_terms=config.get("glossary_terms"),
        )
        # The Realtime wrapper is a scaffold stub; start() raises.
        await broadcast.start()
    except NotImplementedError:
        await _close_with_reason(
            ws,
            CLOSE_NOT_IMPLEMENTED,
            "Live translation is scaffolded but not yet implemented. "
            "Wire OpenAIRealtimeSession.connect() to enable.",
        )
        end_session(event_id)
        record_event_ended()
        return
    except Exception as e:
        logger.exception("Speaker session failed to start: %s", e)
        await _close_with_reason(ws, CLOSE_NOT_IMPLEMENTED, "Internal error")
        end_session(event_id)
        record_event_ended()
        return


@router.websocket("/events/{event_id}/listen")
async def listen_socket(
    ws: WebSocket, event_id: str, lang: str = Query(...)
):
    await ws.accept()
    try:
        validate_event_id(event_id)
        validate_lang(lang)
    except EventKeyError as e:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, e.detail)
        return

    record_attendee_joined()

    # Without an active session, surface a clear close code so the attendee
    # page can render the "this event hasn't started yet / has ended" state.
    await _close_with_reason(
        ws,
        CLOSE_NOT_IMPLEMENTED,
        "Listen path is scaffolded but not yet implemented. "
        "Drive listen_attendee() from service.realtime_session.",
    )
