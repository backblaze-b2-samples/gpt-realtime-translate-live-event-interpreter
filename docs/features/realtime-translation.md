<!-- last_verified: 2026-05-28 -->
# Realtime Translation

## Purpose

Wrap OpenAI's GPT-Realtime-Translate API behind a typed adapter so the rest of the codebase never imports `openai` directly. Mirrors the `boto3`-in-repo containment rule.

## Containment

- The ONLY place `openai` may be imported is `services/api/app/repo/openai_realtime.py`.
- The `tests/test_structure.py::test_openai_only_in_repo` test asserts the rule mechanically.
- All higher layers (`service/`, `runtime/`) drive translation via `OpenAIRealtimeSession`.

## Interface

```python
class OpenAIRealtimeSession:
    async def connect(self) -> None: ...
    async def send_audio_chunk(self, pcm_chunk: bytes) -> None: ...
    async def recv_translation_chunk(self) -> AsyncIterator[RealtimeChunk]: ...
    async def close(self) -> None: ...
```

`RealtimeChunk` is a frozen dataclass with `kind` (`audio` | `transcript` | `source`), `lang`, `payload` (base64 for audio, UTF-8 text for transcripts), `start_ms`, `end_ms`, and `is_final`.

## Scaffold status

`connect()` raises `NotImplementedError("scaffold")` today. The real implementation will:

1. Lazily `import openai` inside `connect()` (keeps the layering test mechanically clean — the static AST scan only sees module-level imports).
2. Open the Realtime client connection authenticated with `OPENAI_API_KEY`.
3. Send a system prompt seeded with the attached glossary's term list plus the target-language list.
4. Yield typed `RealtimeChunk`s from the SDK's event stream.

## Session lifecycle

1. **Open**: speaker socket connects -> `EventBroadcast.start()` calls `OpenAIRealtimeSession.connect()`.
2. **Stream**: source PCM goes in via `send_audio_chunk()`; translated chunks come out via `recv_translation_chunk()`.
3. **Reconnect strategy**: on transient upstream disconnect, retry up to N times with exponential backoff (1s, 2s, 4s, …, capped at 30s). Partial transcript persists on every retry boundary so we never lose more than one window of content.
4. **Close**: idempotent. Always called from `finally:` in the service layer.

## Language list

BCP-47 codes are accepted at the API boundary; the validator (`service.events.LANG_RE`) tolerates lowercase primary subtags with optional region/script (`en`, `es`, `pt-BR`, `zh-Hans`). The Realtime API's supported language list is the upstream cap; unsupported codes are surfaced to the speaker page as a 400 from `POST /events`.

## Tests

- `services/api/tests/test_structure.py::test_openai_only_in_repo` — containment rule.
- `services/api/tests/test_structure.py::test_no_backward_imports` — service may not import from runtime; runtime may not import openai directly.

## Related

- [Live Interpretation](live-interpretation.md)
- [Transcripts & Captions](transcripts-and-captions.md)
- [Glossary](glossary.md)
