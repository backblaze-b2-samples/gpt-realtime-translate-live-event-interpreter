<!-- last_verified: 2026-05-29 -->
# Live Interpretation

## Purpose

Two WebSocket-driven UIs that together make the app's headline feature:

- **Speaker console** (`/live`) — request microphone permission, pick the source language and target languages, then stream source audio over `WS /events/{id}/speaker`. Translated audio is archived to B2 by default (toggle it off to keep only captions/transcripts). Shows a live caption preview (source + every target) and the attendee count.
- **Attendee listen** (`/live/[id]/listen`) — pick a target language, then hear translated audio and read live captions over `WS /events/{id}/listen?lang=<bcp47>`.

The browser talks only to our API; the API bridges to OpenAI (one upstream `gpt-realtime-translate` session per target language) so the OpenAI key never reaches the client. See [Realtime Translation](realtime-translation.md).

## Inputs / outputs

### Speaker socket — `WS /events/{event_id}/speaker`

1. Client connects and sends a JSON config frame:

   ```json
   { "title": "Q3 All-Hands", "source_language": "en", "target_languages": ["es", "fr", "ja"], "persist_translated_audio": true }
   ```

2. Client streams **binary** PCM16 frames (24 kHz, mono, little-endian — the gpt-realtime-translate input format; the speaker page captures at this rate directly).
3. Backend forwards each chunk to every upstream session and streams JSON status frames back:

   ```json
   { "type": "ready", "event_id": "…", "target_languages": ["es", "fr"] }
   { "type": "caption", "lang": "es", "payload": "Hola, mundo.", "start_ms": 1200, "end_ms": 1800, "is_final": true }
   { "type": "caption", "lang": null, "payload": "Hello, world.", "is_final": true }
   { "type": "attendees", "count": 3 }
   ```

   `lang: null` is the source-language transcript mirror. Interim frames (`is_final: false`) carry incremental delta text; final frames carry the full committed segment.

### Attendee socket — `WS /events/{event_id}/listen?lang=<bcp47>`

1. Client connects with the target language as a query string.
2. No active session ⇒ close `4003`. Language not in the event's target list ⇒ close `4002`.
3. Backend streams JSON frames:

   ```json
   { "type": "ready", "lang": "es" }
   { "type": "audio", "lang": "es", "payload": "<base64 pcm16>", "start_ms": 1200, "end_ms": 1800, "is_final": false }
   { "type": "caption", "lang": "es", "payload": "Hola, mundo.", "start_ms": 1200, "end_ms": 1800, "is_final": true }
   ```

### Close codes

| Code | Meaning |
|------|---------|
| `4001` | Session can't start — missing/invalid `OPENAI_API_KEY` or upstream failed to open |
| `4002` | Invalid input — malformed event id / language, or language not offered |
| `4003` | No active session for this event (not started or already ended) |
| `4004` | Client detected an invalid server frame or unsafe audio playback condition and closed the socket. The close reason is `invalid-server-frame:<reason-code>`; reason codes are stable diagnostics such as `malformed-json`, `non-text-data`, `payload-too-large`, `audio-base64-invalid`, `audio-too-large`, or `audio-buffer-overflow`. Raw frame payloads are never included. |

### Wire frame limits

- JSON frames are capped at 256 KiB in the browser.
- Caption payloads are capped at 16 KiB UTF-8 per frame. The backend chunks outgoing caption frames on UTF-8 boundaries before sending to speakers or attendees.
- Audio payloads are capped at 96,000 decoded PCM bytes per frame. The backend chunks outgoing base64 PCM before sending to attendees.
- Interim caption state is capped at 64 KiB per language in the browser. Overflow closes with `4004` / `invalid-server-frame:caption-buffer-overflow`.

## Flow

1. Speaker opens the speaker socket and sends config.
2. `service.realtime_session.start_session(...)` registers an `EventBroadcast`, marks the event `live` in `event.json`, and opens **one** `OpenAIRealtimeSession` per target language.
3. Source PCM flows speaker → service → every upstream session.
4. Each session's translated audio + transcript flows back → service fans out to the matching per-language attendee queues (and the speaker monitor for captions).
5. Final transcript cues accumulate and persist on a 15 s cadence + on close (`events/<id>/<lang>/…` and `events/<id>/source-transcript.*`).
6. On disconnect the broadcast drains, writes `source.wav` (and per-language `audio.wav` when opted in), and flips the manifest to `ended` with duration + attendee peak — so `/events` and `/events/[id]` fill with real data.

## Edge cases

- **No `OPENAI_API_KEY`** — `connect()` raises and the speaker socket closes with `4001`; the rest of the app stays usable. The API also logs a warning at startup.
- **Speaker disconnects mid-event** — the broadcast tears down and the partial transcript is already persisted, so attendees who joined late still have a record.
- **Attendee picks an unsupported language** — the socket closes with `4002`.
- **Malformed server frames** — the speaker and attendee clients validate incoming JSON frames, ignore unknown additive frame types, show an error state for invalid known frames, and close with app code `4004` plus a low-cardinality diagnostic close reason instead of throwing in the browser.
- **Audio-frame floods** — attendee playback caps scheduled translated audio at 10 seconds. A flood of individually valid audio frames closes with `4004` / `invalid-server-frame:audio-buffer-overflow` before allocating more decoded samples or `AudioBuffer`s.
- **Caption-frame floods** — repeated valid interim caption frames close with `4004` / `invalid-server-frame:caption-buffer-overflow` once one language's interim buffer would exceed 64 KiB.
- **Superseded starts/joins** — speaker starts and attendee joins use generation guards across microphone and audio-resume awaits; stale attempts close their resources and cannot overwrite the current socket.
- **Single-instance only** — the session registry is in-memory; multi-instance needs shared state (see [RELIABILITY.md](../RELIABILITY.md)).

## Tests

- `services/api/tests/test_realtime.py` — adapter event parsing (mocked websocket) + fan-out / source-dedup / persistence.
- `services/api/tests/test_realtime_wire.py` — backend outgoing audio/caption frame chunking against the client wire limits.
- `services/api/tests/test_structure.py::test_openai_only_in_repo` — OpenAI containment.
- `services/api/tests/test_structure.py::test_no_websocket_business_logic` — `runtime/live.py` drives `service.realtime_session`, never `repo/`.
- `apps/web/e2e/live-speaker-smoke.spec.ts` — speaker form renders.
- `apps/web/e2e/attendee-language-pick.spec.ts` — attendee page renders.
- `apps/web/e2e/realtime-invalid-frames.spec.ts` — browser-level malformed-frame handling for speaker and attendee sessions.
- `apps/web/e2e/realtime-audio-flood.spec.ts` / `realtime-caption-flood.spec.ts` — flood handling for valid-but-excessive audio and interim caption frames.
- `apps/web/e2e/realtime-frame-limits.spec.ts` — largest valid browser frame limits remain accepted.
- `apps/web/e2e/realtime-start-races.spec.ts` — delayed speaker starts and listener joins cannot overwrite newer attempts.

## Related

- [Realtime Translation](realtime-translation.md)
- [Transcripts & Captions](transcripts-and-captions.md)
- [Glossary](glossary.md)
- [Event Archive](event-archive.md)
