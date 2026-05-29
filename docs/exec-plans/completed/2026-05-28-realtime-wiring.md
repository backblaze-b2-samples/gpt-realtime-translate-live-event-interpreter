# Plan: Realtime Wiring (gpt-realtime-translate end-to-end)

Wires the live-interpretation feature end to end: the OpenAI Realtime
*Translations* adapter, the service fan-out, the speaker/listen WebSocket
loops, transcript + audio archival, and the speaker/attendee UIs. Replaces the
scaffold stubs that raised `NotImplementedError("scaffold")`.

## Reality check (researched against OpenAI docs, May 2026)

`gpt-realtime-translate` is a real GA model with a **dedicated** endpoint and a
protocol that differs from the standard Realtime API:

- Endpoint: `wss://api.openai.com/v1/realtime/translations?model=<model>`,
  header `Authorization: Bearer <OPENAI_API_KEY>`.
- **One session = one output language.** Set via `session.update` →
  `session.audio.output.language`. Multiple targets ⇒ multiple sessions.
- Source language is **auto-detected** (no field to set).
- Audio is **base64 little-endian PCM16 @ 24 kHz, mono** — not 16 kHz.
- Client → server: `session.input_audio_buffer.append` (`{audio: <b64>}`).
  Keep sending continuously (incl. silence) — sessions are not turn-based.
- Server → client deltas: `session.output_audio.delta` (translated audio),
  `session.output_transcript.delta` (translated text),
  `session.input_transcript.delta` (source text). End: `session.closed`.
- OpenAI's own docs drive this endpoint with **raw websockets** (no typed SDK
  helper), in Python too.

### Decision: `websockets`, not the `openai` SDK

The translations endpoint has no first-class typed helper in the SDK and uses a
`session.*` protocol the SDK's standard-Realtime event models don't cover. We
therefore implement the adapter with the async `websockets` library (already a
transitive dep of `uvicorn[standard]`; pinned explicitly in `requirements.txt`).

This keeps the **containment rule** intact in spirit and mechanically:
`repo/openai_realtime.py` remains the single point of contact with OpenAI's
realtime API; nothing else talks to it. `test_openai_only_in_repo` still passes
(no `openai` import anywhere). AGENTS.md §2 and the realtime-translation feature
doc are updated to say "the adapter speaks the Realtime Translations protocol
over `websockets`."

Glossary biasing is **not** wired: the translate model auto-detects source and
does not accept a system prompt the way a chat model does. `glossary_terms`
stays plumbed through the interface for forward-compat but is a no-op today;
tracked in the tech-debt tracker.

## Scope

1. **Adapter** (`repo/openai_realtime.py`): one session per target language.
2. **Service fan-out** (`service/realtime_session.py`): `EventBroadcast` holds
   one adapter session per target language, fans source audio to all, pumps
   each session's output to per-language attendee queues, accumulates final
   transcript chunks + PCM for archival, persists on a cadence + on close,
   writes the `event.json` lifecycle (live → ended).
3. **WebSocket loops** (`runtime/live.py`): speaker receive-loop + listen
   stream-loop; no `repo/` imports (layering).
4. **Helpers**: `update_manifest()` in `service/events.py`;
   `service/audio_archive.py` (PCM16 → WAV bytes + persist source/translated).
5. **Frontend**: `lib/realtime.ts` (WS hooks + mic capture + PCM playback),
   speaker console `/live`, attendee `/live/[id]/listen`.
6. **Tests**: `tests/test_realtime.py` (mocked websockets) + updated e2e specs.
7. **Docs**: live-interpretation, realtime-translation, ARCHITECTURE, README,
   AGENTS, tech-debt-tracker.

## WS bridge contract (browser ⇄ our API)

The browser talks to **our** API, which bridges to OpenAI (one upstream session
per language). It never holds the OpenAI key.

### Speaker — `WS /events/{event_id}/speaker`

1. Client sends a JSON config frame:
   `{ "title", "source_language", "target_languages": [...], "persist_translated_audio"? }`.
2. Client streams **binary** PCM16 @ 24 kHz mono frames.
3. Backend → speaker JSON status frames: `{type:"ready"}`,
   `{type:"caption", lang, payload, is_final}` (all languages + source for the
   live preview), `{type:"attendees", count}`, `{type:"error", reason}`.
4. On disconnect: finalize transcripts/captions + source.wav, mark event ended.

### Attendee — `WS /events/{event_id}/listen?lang=<bcp47>`

1. Connects with the target language as a query param.
2. No active session ⇒ close `4003`. Unsupported language ⇒ close `4002`.
3. Backend streams JSON frames (matches the existing feature-doc shape):
   `{type:"audio", lang, payload:<b64 pcm16>, start_ms, end_ms, is_final}` and
   `{type:"caption", lang, payload:<text>, start_ms, end_ms, is_final}`.

Close codes: `4001` not-implemented/no key, `4002` invalid input, `4003` no
active session.

## Persistence

- Transcripts/captions via existing `service.transcripts.persist_chunks`
  (resolves the open tech-debt item). Source = `lang=None`; each target = its
  code. Cadence: every ~15 s of finals + a final flush on close.
- `source.wav` always (24 kHz mono PCM16, stdlib `wave`), capped at
  `settings.max_file_size`. Per-language `audio.wav` only when
  `persist_translated_audio` is on.
- `event.json`: `update_manifest()` sets `status=live, started_at, title,
  languages` on start and `status=ended, ended_at, duration_ms, attendee_peak`
  on close, so `/events` and `/events/[id]` fill with real data after a session.

## Steps

1. Exec plan (this file).
2. Adapter rewrite (one session/lang, websockets, delta→RealtimeChunk with
   elapsed timestamps + sentence-boundary finals).
3. `service/audio_archive.py` + `update_manifest()` in `service/events.py`.
4. `service/realtime_session.py` rewrite (fan-out pump, accumulation, persist,
   lifecycle).
5. `runtime/live.py` rewrite (speaker + listen loops).
6. `requirements.txt`: add `websockets`.
7. Backend tests (`tests/test_realtime.py`).
8. Frontend `lib/realtime.ts` + `api-client.wsUrl`.
9. Speaker + attendee pages; event-card "Go live"; update e2e specs.
10. Docs + tech-debt tracker; run `lint:api test:api check:structure lint
    build`; move this plan to `completed/`.

## Out of scope / follow-ups

- Glossary biasing into the translate session (model limitation; tracked).
- Speaker auth token (`SpeakerSessionToken` exists but isn't enforced yet).
- Multi-instance shared session registry (still in-memory; see RELIABILITY.md).
- Upstream reconnect/backoff (single-attempt connect for now).
