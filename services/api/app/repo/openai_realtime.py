"""OpenAI Realtime API adapter — the ONLY module allowed to import `openai`.

Mirrors the boto3 containment rule: all higher layers (`service/`, `runtime/`)
call into the typed interface here and never touch the SDK directly. This is
enforced by `tests/test_structure.py::test_openai_only_in_repo`.

The interface is intentionally small (connect / send / recv / close) so we
can swap the underlying transport (WebSocket, gRPC, HTTP/2) without churn in
the service layer.

Scaffold status:
    The methods below are *typed stubs*. The real OpenAI Realtime wiring
    lands in a follow-up exec plan (see
    `docs/exec-plans/active/realtime-wiring.md` once that plan is created).
    Calling `connect()` today raises `NotImplementedError("scaffold")` so the
    layering tests, route handlers, and frontend mocks can all be exercised
    end-to-end without an OpenAI key.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import AsyncIterator

# NOTE: `openai` is intentionally NOT imported at module load — the SDK is a
# heavy dependency and we want `app.repo` importable without it being
# installed in test environments. The real implementation will import lazily
# inside `connect()`. The structural test only inspects static imports, so
# moving the import inside the function keeps the rule mechanically clean as
# well.

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RealtimeChunk:
    """A chunk emitted by the Realtime stream.

    `kind` is one of:
      - "audio"      — base64-encoded translated audio for `lang`
      - "transcript" — interim or final translated transcript text
      - "source"     — the source-language ASR transcript (mirrored back so
                       we can persist `source-transcript.{txt,vtt}`)
    """

    kind: str
    lang: str | None
    payload: str  # base64 for audio, UTF-8 text for transcripts
    start_ms: int
    end_ms: int
    is_final: bool = False


class OpenAIRealtimeSession:
    """A single live translation session.

    One instance per event. The session multiplexes outgoing source audio
    chunks (from the speaker) into a single upstream Realtime connection and
    yields incoming chunks (translated audio + captions for every target
    language) over an async iterator that the service layer fans out to
    attendee queues.
    """

    def __init__(
        self,
        *,
        event_id: str,
        source_language: str,
        target_languages: list[str],
        glossary_terms: list[dict] | None = None,
        model: str | None = None,
        api_key: str | None = None,
    ):
        self.event_id = event_id
        self.source_language = source_language
        self.target_languages = list(target_languages)
        self.glossary_terms = list(glossary_terms or [])
        self.model = model
        self._api_key = api_key
        self._connected = False

    async def connect(self) -> None:
        """Open the upstream Realtime session.

        Scaffold: raises `NotImplementedError`. The real implementation will:
          1. Lazily `import openai` (so the layering tests stay clean).
          2. Open a Realtime client connection authenticated with `self._api_key`.
          3. Send a system prompt seeded with `self.glossary_terms` and the
             list of target languages.
          4. Set `self._connected = True`.
        """
        raise NotImplementedError("scaffold")

    async def send_audio_chunk(self, pcm_chunk: bytes) -> None:
        """Forward a source-audio chunk to the upstream session.

        Scaffold: raises `NotImplementedError`. The real implementation will
        push the PCM bytes onto the Realtime input stream and return as soon
        as the SDK acknowledges receipt (no waiting on translation).
        """
        raise NotImplementedError("scaffold")

    async def recv_translation_chunk(self) -> AsyncIterator[RealtimeChunk]:
        """Async iterator over translated audio + caption chunks.

        Scaffold: raises `NotImplementedError`. The real implementation will
        wrap the SDK's event stream and yield typed `RealtimeChunk` values
        until the upstream session ends or `close()` is called.
        """
        raise NotImplementedError("scaffold")

    async def close(self) -> None:
        """Tear down the upstream session.

        Idempotent. Always safe to call from a `finally:` block in the
        service layer.
        """
        self._connected = False
