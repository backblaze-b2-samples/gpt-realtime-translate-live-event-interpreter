"""Tests for the OpenAI Realtime translations adapter + the service fan-out.

The adapter is exercised against a fake websocket (no network, no key needed);
the fan-out is exercised against a fake `OpenAIRealtimeSession` and stubbed
persistence so we never touch B2.
"""

import base64
import json
from typing import ClassVar

import pytest
import websockets

from app.repo.openai_realtime import OpenAIRealtimeSession, RealtimeChunk


class FakeWS:
    """Minimal stand-in for a websockets client connection."""

    def __init__(self, incoming: list[str]):
        self.sent: list[str] = []
        self._incoming = list(incoming)
        self.closed = False

    async def send(self, data):
        self.sent.append(data)

    async def close(self):
        self.closed = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._incoming:
            raise StopAsyncIteration
        return self._incoming.pop(0)


# --- adapter ---


async def test_adapter_parses_events_into_chunks(monkeypatch):
    events = [
        json.dumps({"type": "session.output_transcript.delta", "delta": "Hola"}),
        json.dumps({"type": "session.output_transcript.delta", "delta": " mundo."}),
        json.dumps({"type": "session.output_audio.delta", "delta": "QUJD"}),
        json.dumps({"type": "session.input_transcript.delta", "delta": "Hello world."}),
        json.dumps({"type": "session.closed"}),
    ]
    fake = FakeWS(events)

    async def fake_connect(url, **kwargs):
        assert "model=gpt-realtime-translate" in url
        return fake

    monkeypatch.setattr(websockets, "connect", fake_connect)

    session = OpenAIRealtimeSession(
        event_id="evt123",
        target_language="es",
        source_language="en",
        api_key="test-key",
    )
    await session.connect()

    # session.update configures the output language.
    update = json.loads(fake.sent[0])
    assert update["type"] == "session.update"
    assert update["session"]["audio"]["output"]["language"] == "es"

    await session.send_audio_chunk(b"\x01\x02\x03")
    append = json.loads(fake.sent[-1])
    assert append["type"] == "session.input_audio_buffer.append"
    assert append["audio"] == base64.b64encode(b"\x01\x02\x03").decode("ascii")

    chunks = [c async for c in session.recv_translation_chunk()]
    finals = [c for c in chunks if c.is_final]

    # One committed translated cue + one committed source cue.
    transcript_final = next(c for c in finals if c.kind == "transcript")
    assert transcript_final.lang == "es"
    assert transcript_final.payload == "Hola mundo."
    source_final = next(c for c in finals if c.kind == "source")
    assert source_final.lang is None
    assert source_final.payload == "Hello world."

    audio = next(c for c in chunks if c.kind == "audio")
    assert audio.lang == "es"
    assert audio.payload == "QUJD"

    await session.close()
    assert fake.closed
    assert any(json.loads(m).get("type") == "session.close" for m in fake.sent)


async def test_adapter_requires_api_key():
    session = OpenAIRealtimeSession(event_id="evt123", target_language="es")
    with pytest.raises(RuntimeError):
        await session.connect()


# --- fan-out ---


class FakeSession:
    """Fake `OpenAIRealtimeSession` that replays scripted chunks per language."""

    script: ClassVar[dict[str, list[RealtimeChunk]]] = {}

    def __init__(self, *, event_id, target_language, **kwargs):
        self.event_id = event_id
        self.target_language = target_language
        self.closed = False

    async def connect(self):
        pass

    async def send_audio_chunk(self, pcm_chunk):
        pass

    async def recv_translation_chunk(self):
        for chunk in FakeSession.script.get(self.target_language, []):
            yield chunk

    async def close(self):
        self.closed = True


@pytest.fixture
def fan_out(monkeypatch):
    """Patch the session class + persistence sinks in realtime_session."""
    from app.service import realtime_session as rs

    calls = {"persist": [], "source_audio": [], "manifest": []}
    monkeypatch.setattr(rs, "OpenAIRealtimeSession", FakeSession)
    monkeypatch.setattr(
        rs, "persist_chunks", lambda eid, lang, chunks: calls["persist"].append((lang, len(chunks)))
    )
    monkeypatch.setattr(
        rs, "persist_source_audio", lambda eid, pcm: calls["source_audio"].append(len(pcm))
    )
    monkeypatch.setattr(rs, "persist_translated_audio", lambda eid, lang, pcm: None)
    monkeypatch.setattr(
        rs, "update_manifest", lambda eid, **f: calls["manifest"].append(f.get("status"))
    )
    return rs, calls


async def test_broadcast_fans_out_and_accumulates(fan_out):
    rs, calls = fan_out
    FakeSession.script = {
        "es": [
            RealtimeChunk("audio", "es", "QUJD", 0, 0),
            RealtimeChunk("transcript", "es", "Hola.", 0, 100, is_final=True),
            RealtimeChunk("source", None, "Hello.", 0, 100, is_final=True),
        ]
    }
    broadcast = rs.EventBroadcast(
        event_id="evt123", source_language="en", target_languages=["es"]
    )
    queue = broadcast.attendee_queue("es")  # register before start to avoid races
    await broadcast.start()
    await broadcast.stop()

    # Attendee saw the audio + the translated caption (source goes to monitor only).
    delivered = []
    while not queue.empty():
        delivered.append(queue.get_nowait())
    kinds = {c.kind for c in delivered}
    assert kinds == {"audio", "transcript"}

    # Final cues accumulated for both the target language and the source.
    persisted = dict(calls["persist"])
    assert persisted.get("es") == 1
    assert persisted.get(None) == 1
    assert calls["manifest"] == ["live", "ended"]


async def test_broadcast_dedupes_source_across_languages(fan_out):
    rs, calls = fan_out
    src = RealtimeChunk("source", None, "Hello.", 0, 100, is_final=True)
    FakeSession.script = {"es": [src], "fr": [src]}
    broadcast = rs.EventBroadcast(
        event_id="evt123", source_language="en", target_languages=["es", "fr"]
    )
    await broadcast.start()
    await broadcast.stop()

    # Both sessions emit the source transcript, but only session 0 is recorded.
    persisted = dict(calls["persist"])
    assert persisted.get(None) == 1
