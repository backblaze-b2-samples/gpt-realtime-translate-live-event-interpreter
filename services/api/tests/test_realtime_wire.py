"""Realtime WebSocket wire-frame contract tests."""

import base64

from app.repo.openai_realtime import RealtimeChunk
from app.runtime.live import CLOSE_INVALID_INPUT, _chunk_frames, _close_with_reason
from app.types.realtime_wire import (
    MAX_WIRE_AUDIO_PCM_BYTES,
    MAX_WIRE_TEXT_PAYLOAD_BYTES,
)


def test_wire_keeps_largest_valid_audio_frame_single():
    pcm = b"\x01\x02" * (MAX_WIRE_AUDIO_PCM_BYTES // 2)
    payload = base64.b64encode(pcm).decode("ascii")
    frames = _chunk_frames(RealtimeChunk("audio", "es", payload, 0, 100))

    assert len(frames) == 1
    assert frames[0]["type"] == "audio"
    assert len(base64.b64decode(frames[0]["payload"])) == MAX_WIRE_AUDIO_PCM_BYTES


def test_wire_chunks_oversized_audio_frames():
    pcm = b"\x01\x02" * ((MAX_WIRE_AUDIO_PCM_BYTES // 2) + 1)
    payload = base64.b64encode(pcm).decode("ascii")
    frames = _chunk_frames(RealtimeChunk("audio", "es", payload, 0, 100))

    decoded_lengths = [len(base64.b64decode(frame["payload"])) for frame in frames]
    assert decoded_lengths == [MAX_WIRE_AUDIO_PCM_BYTES, 2]


def test_wire_chunks_audio_with_missing_padding():
    payload = base64.b64encode(b"\x01\x02").decode("ascii").rstrip("=")
    frames = _chunk_frames(RealtimeChunk("audio", "es", payload, 0, 100))

    assert len(frames) == 1
    assert base64.b64decode(frames[0]["payload"]) == b"\x01\x02"


def test_wire_drops_invalid_or_empty_audio_frames():
    invalid = _chunk_frames(RealtimeChunk("audio", "es", "not base64!", 0, 100))
    empty = _chunk_frames(RealtimeChunk("audio", "es", "", 0, 100))

    assert invalid == []
    assert empty == []


def test_wire_keeps_largest_valid_caption_frame_single():
    payload = "x" * MAX_WIRE_TEXT_PAYLOAD_BYTES
    frames = _chunk_frames(RealtimeChunk("transcript", "es", payload, 0, 100))

    assert len(frames) == 1
    assert frames[0]["type"] == "caption"
    assert len(frames[0]["payload"].encode("utf-8")) == MAX_WIRE_TEXT_PAYLOAD_BYTES


def test_wire_chunks_oversized_caption_frames_on_utf8_boundary():
    payload = ("é" * (MAX_WIRE_TEXT_PAYLOAD_BYTES // 2)) + "fin"
    frames = _chunk_frames(RealtimeChunk("transcript", "es", payload, 0, 100))

    payloads = [frame["payload"] for frame in frames]
    assert "".join(payloads) == payload
    assert [len(value.encode("utf-8")) for value in payloads] == [
        MAX_WIRE_TEXT_PAYLOAD_BYTES,
        3,
    ]


class FakeWebSocket:
    def __init__(self):
        self.closed_with: int | None = None
        self.sent: list[dict] = []

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int) -> None:
        self.closed_with = code


async def test_close_with_reason_uses_application_close_code():
    ws = FakeWebSocket()

    await _close_with_reason(ws, CLOSE_INVALID_INPUT, "Bad input")

    assert ws.sent == [
        {"type": "close", "code": CLOSE_INVALID_INPUT, "reason": "Bad input"}
    ]
    assert ws.closed_with == CLOSE_INVALID_INPUT
