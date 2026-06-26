"""WebSocket routes for the live-interpretation surface.

Two sockets per event:

  - `WS /events/{event_id}/speaker` — the speaker page sends a JSON config
    frame, then streams binary PCM16 (24 kHz, mono) audio. The backend bridges
    to the OpenAI Realtime translation sessions via
    `service.realtime_session` and streams caption + attendee-count frames
    back for the live preview.
  - `WS /events/{event_id}/listen` — attendees subscribe with `?lang=` and
    receive translated audio + caption JSON frames.

Layering: this module drives translation through `service.realtime_session`
and never imports `repo/` (enforced by
`tests/test_structure.py::test_no_websocket_business_logic`).
"""

import asyncio
import base64
import contextlib
import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.runtime.metrics import (
    record_attendee_joined,
    record_event_ended,
    record_event_started,
)
from app.service.events import EventKeyError, validate_event_id, validate_lang
from app.service.realtime_session import (
    EventBroadcast,
    end_session,
    get_session,
    listen_attendee,
    start_session,
)
from app.types.realtime_wire import (
    MAX_WIRE_AUDIO_BASE64_CHARS,
    MAX_WIRE_TEXT_PAYLOAD_BYTES,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Structured close codes (4xxx range is application-level per the WS spec).
CLOSE_CANNOT_START = 4001  # no OPENAI_API_KEY, or upstream failed to open
CLOSE_INVALID_INPUT = 4002
CLOSE_NO_EVENT = 4003


async def _close_with_reason(ws: WebSocket, code: int, reason: str) -> None:
    """Send a structured close frame the frontend can branch on, then close."""
    with contextlib.suppress(Exception):
        await ws.send_json({"type": "close", "code": code, "reason": reason})
    with contextlib.suppress(Exception):
        await ws.close(code=code)


def _frame_for_payload(chunk, payload: str) -> dict:
    """Serialize a `RealtimeChunk` into the attendee/speaker wire frame."""
    return {
        "type": "audio" if chunk.kind == "audio" else "caption",
        "lang": chunk.lang,
        "payload": payload,
        "start_ms": chunk.start_ms,
        "end_ms": chunk.end_ms,
        "is_final": chunk.is_final,
    }


def _text_payload_chunks(payload: str) -> list[str]:
    """Split text by UTF-8 bytes so each frame stays inside the wire contract."""
    if payload == "":
        return [payload]
    chunks: list[str] = []
    current: list[str] = []
    current_bytes = 0
    for char in payload:
        char_bytes = len(char.encode("utf-8"))
        if current and current_bytes + char_bytes > MAX_WIRE_TEXT_PAYLOAD_BYTES:
            chunks.append("".join(current))
            current = []
            current_bytes = 0
        current.append(char)
        current_bytes += char_bytes
    if current:
        chunks.append("".join(current))
    return chunks


def _audio_payload_chunks(payload: str) -> list[str]:
    """Split base64 PCM by decoded bytes so browser playback caps are meaningful."""
    if not payload:
        return []
    chunks: list[str] = []
    for start in range(0, len(payload), MAX_WIRE_AUDIO_BASE64_CHARS):
        encoded = payload[start : start + MAX_WIRE_AUDIO_BASE64_CHARS]
        padded = encoded + ("=" * (-len(encoded) % 4))
        try:
            decoded = base64.b64decode(padded, validate=True)
        except Exception:
            return []
        if len(decoded) % 2:
            decoded = decoded[:-1]
        if decoded:
            chunks.append(base64.b64encode(decoded).decode("ascii"))
    return chunks


def _chunk_frames(chunk) -> list[dict]:
    """Serialize a `RealtimeChunk` into one or more bounded wire frames."""
    payloads = (
        _audio_payload_chunks(chunk.payload)
        if chunk.kind == "audio"
        else _text_payload_chunks(chunk.payload)
    )
    return [_frame_for_payload(chunk, payload) for payload in payloads]


@router.websocket("/events/{event_id}/speaker")
async def speaker_socket(ws: WebSocket, event_id: str):
    await ws.accept()
    try:
        validate_event_id(event_id)
    except EventKeyError as e:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, e.detail)
        return

    try:
        config = await ws.receive_json()
    except (WebSocketDisconnect, json.JSONDecodeError, KeyError, RuntimeError):
        return

    source_language = str(config.get("source_language") or "en")
    target_languages = [str(c) for c in (config.get("target_languages") or [])]
    if not target_languages:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, "No target languages configured")
        return
    try:
        for code in [source_language, *target_languages]:
            validate_lang(code)
    except EventKeyError as e:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, e.detail)
        return

    record_event_started()
    try:
        broadcast = start_session(
            event_id=event_id,
            source_language=source_language,
            target_languages=target_languages,
            glossary_terms=config.get("glossary_terms"),
            title=config.get("title"),
            persist_translated_audio=bool(config.get("persist_translated_audio", False)),
        )
        await broadcast.start()
    except RuntimeError as e:
        await _close_with_reason(ws, CLOSE_CANNOT_START, str(e))
        end_session(event_id)
        record_event_ended()
        return
    except Exception as e:
        logger.exception("Speaker session failed to start: %s", e)
        await _close_with_reason(ws, CLOSE_CANNOT_START, "Failed to open translation session")
        end_session(event_id)
        record_event_ended()
        return

    await ws.send_json(
        {"type": "ready", "event_id": event_id, "target_languages": target_languages}
    )
    monitor = asyncio.create_task(_speaker_monitor(ws, broadcast))
    try:
        await _speaker_ingest(ws, broadcast)
    except WebSocketDisconnect:
        pass
    finally:
        monitor.cancel()
        await asyncio.gather(monitor, return_exceptions=True)
        await broadcast.stop()
        end_session(event_id)
        record_event_ended()


async def _speaker_ingest(ws: WebSocket, broadcast: EventBroadcast) -> None:
    """Pump inbound frames: binary -> source audio; `{type:"stop"}` -> end."""
    while True:
        message = await ws.receive()
        if message["type"] == "websocket.disconnect":
            return
        if message.get("bytes") is not None:
            await broadcast.push_source_audio(message["bytes"])
        elif message.get("text"):
            try:
                data = json.loads(message["text"])
            except json.JSONDecodeError:
                continue
            if data.get("type") == "stop":
                return


async def _speaker_monitor(ws: WebSocket, broadcast: EventBroadcast) -> None:
    """Relay caption chunks + attendee-count changes to the speaker preview."""
    queue = broadcast.monitor_queue()
    last_count = -1
    try:
        while True:
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=2.0)
                for frame in _chunk_frames(chunk):
                    await ws.send_json(frame)
            except TimeoutError:
                pass
            if broadcast.attendee_count != last_count:
                last_count = broadcast.attendee_count
                await ws.send_json({"type": "attendees", "count": last_count})
    finally:
        broadcast.drop_monitor(queue)


@router.websocket("/events/{event_id}/listen")
async def listen_socket(ws: WebSocket, event_id: str, lang: str = Query(...)):
    await ws.accept()
    try:
        validate_event_id(event_id)
        validate_lang(lang)
    except EventKeyError as e:
        await _close_with_reason(ws, CLOSE_INVALID_INPUT, e.detail)
        return

    broadcast = get_session(event_id)
    if broadcast is None:
        await _close_with_reason(ws, CLOSE_NO_EVENT, "This event is not live right now.")
        return
    if lang not in broadcast.target_languages:
        await _close_with_reason(
            ws, CLOSE_INVALID_INPUT, f"Language '{lang}' is not offered for this event."
        )
        return

    record_attendee_joined()
    await ws.send_json({"type": "ready", "lang": lang})
    try:
        async for chunk in listen_attendee(event_id, lang):
            for frame in _chunk_frames(chunk):
                await ws.send_json(frame)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Listen stream failed: event_id=%s lang=%s", event_id, lang)
