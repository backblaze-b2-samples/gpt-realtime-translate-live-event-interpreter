<!-- last_verified: 2026-05-28 -->
# Realtime Translation

## Purpose

Wrap OpenAI's `gpt-realtime-translate` API behind a typed adapter so the rest of the codebase never contacts OpenAI's realtime API directly. Mirrors the `boto3`-in-repo containment rule.

## Containment

- The ONLY module that contacts OpenAI's realtime API is `services/api/app/repo/openai_realtime.py`.
- `tests/test_structure.py::test_openai_only_in_repo` asserts no `openai` import exists outside it (the import stays vacuously contained — see the transport note below).
- All higher layers (`service/`, `runtime/`) drive translation via `OpenAIRealtimeSession`.

## Transport — websockets, not the `openai` SDK

`gpt-realtime-translate` uses a **dedicated** endpoint (`wss://api.openai.com/v1/realtime/translations`) and a `session.*` event protocol distinct from the standard Realtime API. There is no first-class typed `openai`-SDK helper for it (OpenAI's own docs drive it with raw websockets, in Python too), so the adapter uses the async `websockets` library — a transitive dependency of `uvicorn[standard]`, pinned explicitly in `requirements.txt` and imported lazily inside `connect()`. The containment intent is preserved: this file is the single point of contact with OpenAI's realtime API.

## One session per output language

A translation session is configured around **one** output language (`session.audio.output.language`). An event with N target languages therefore opens N sessions; the service layer (`service.realtime_session.EventBroadcast`) fans the same source audio to all of them and tags each session's output with its language. The source language is **auto-detected** by the model.

## Protocol

```
connect   wss://api.openai.com/v1/realtime/translations?model=<model>
          header: Authorization: Bearer <OPENAI_API_KEY>
configure session.update -> session.audio.output.language = <bcp47>
          (input transcription model: gpt-realtime-whisper)
input     session.input_audio_buffer.append { audio: <b64 pcm16 24kHz mono LE> }
output    session.output_audio.delta        translated audio (b64)
          session.output_transcript.delta   translated text
          session.input_transcript.delta    source-language text
end       session.close -> session.closed
```

## Interface

```python
class OpenAIRealtimeSession:
    async def connect(self) -> None: ...
    async def send_audio_chunk(self, pcm_chunk: bytes) -> None: ...
    async def recv_translation_chunk(self) -> AsyncIterator[RealtimeChunk]: ...
    async def close(self) -> None: ...
```

`RealtimeChunk` is a frozen dataclass with `kind` (`audio` | `transcript` | `source`), `lang`, `payload` (base64 for audio, UTF-8 text for transcripts), `start_ms`, `end_ms`, and `is_final`. Transcript deltas accumulate into segments; a segment is committed (`is_final=True`, eligible for a VTT cue) at sentence-final punctuation, with a trailing flush on close.

## Language list

BCP-47 codes are accepted at the API boundary; the validator (`service.events.LANG_RE`) tolerates lowercase primary subtags with optional region/script (`en`, `es`, `pt-BR`, `zh-Hans`). The model's supported language list is the upstream cap.

## Known limitations

- **Glossary biasing is not applied.** `glossary_terms` is plumbed through the interface for forward-compat, but the translate model auto-detects source and does not take a system prompt the way a chat model does. Tracked in the [tech-debt tracker](../exec-plans/tech-debt-tracker.md).
- **Single-attempt connect** — no reconnect/backoff on transient upstream drop yet.

## Tests

- `tests/test_realtime.py` — adapter parses `session.*` events into `RealtimeChunk`s against a fake websocket; `connect()` without a key raises.
- `tests/test_structure.py::test_openai_only_in_repo` / `test_no_backward_imports`.

## Related

- [Live Interpretation](live-interpretation.md)
- [Transcripts & Captions](transcripts-and-captions.md)
- [Glossary](glossary.md)
