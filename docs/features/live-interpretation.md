<!-- last_verified: 2026-05-28 -->
# Live Interpretation

## Purpose

Two WebSocket-driven UIs that together make the app's headline feature:

- **Speaker console** (`/live`) — request microphone permission, configure source + target languages, optionally attach a glossary, then stream source audio over `WS /events/{id}/speaker`.
- **Attendee listen** (`/live/[id]/listen`) — pick a target language, then receive translated audio + captions over `WS /events/{id}/listen?lang=<bcp47>`.

## Scaffold status

The route handlers, layering, and structural enforcement are real today. The actual translation transport is staged behind `OpenAIRealtimeSession.connect()` in `services/api/app/repo/openai_realtime.py`, which currently raises `NotImplementedError("scaffold")`. The speaker handler catches that exception and closes the WebSocket with a structured frame:

```json
{ "type": "close", "code": 4001, "reason": "Live translation is scaffolded but not yet implemented." }
```

The attendee handler returns the same shape with the message scoped to "Listen path is scaffolded". The follow-up exec plan will wire `OpenAIRealtimeSession.connect()` to the OpenAI Realtime SDK.

## Inputs / outputs

### Speaker socket — `WS /events/{event_id}/speaker`

1. Client connects.
2. Client sends a JSON config frame:

   ```json
   {
     "source_language": "en",
     "target_languages": ["es", "fr", "ja"],
     "glossary_terms": []
   }
   ```

3. Client streams binary PCM chunks (16-bit, 16 kHz, mono — chosen for compatibility with the Realtime API; the speaker page handles the resample).
4. Backend pushes every chunk into the upstream Realtime session.

### Attendee socket — `WS /events/{event_id}/listen?lang=<bcp47>`

1. Client connects with the language as a query string.
2. Backend validates the language against the event's target list. Unsupported language closes with code `4002`.
3. Backend streams JSON frames:

   ```json
   { "type": "audio", "lang": "es", "payload": "<base64-pcm>", "start_ms": 1200, "end_ms": 1800, "is_final": false }
   { "type": "caption", "lang": "es", "payload": "Hola, mundo.", "start_ms": 1200, "end_ms": 1800, "is_final": true }
   ```

## Flow

1. Speaker creates the event (`POST /events`) and opens the speaker socket.
2. `service.realtime_session.start_session(...)` registers an `EventBroadcast` for the event and opens an upstream Realtime session.
3. Source PCM chunks flow speaker → service → repo → OpenAI.
4. Translated chunks flow OpenAI → repo → service → per-language attendee queues → attendee sockets.
5. On clean disconnect, the service ends the broadcast and finalizes per-language transcript / caption files in B2.
6. On error, the WebSocket emits a structured close frame the frontend can branch on.

## Edge cases

- **No `OPENAI_API_KEY`** — the speaker socket closes with code `4001` and the API logs a warning at startup. Browsing existing events still works.
- **Speaker disconnects mid-event** — the broadcast tears down and the partial transcript is persisted to `events/<id>/<lang>/transcript.txt` so attendees who joined late still have a record.
- **Attendee picks an unsupported language** — the socket closes with code `4002`; the attendee page falls back to the source-language audio (no translation) and surfaces an inline notice.

## Tests

- `services/api/tests/test_structure.py::test_openai_only_in_repo` — only `repo/openai_realtime.py` may import `openai`.
- `services/api/tests/test_structure.py::test_no_websocket_business_logic` — `runtime/live.py` must not import from `repo/`.
- `apps/web/e2e/live-speaker-smoke.spec.ts` — speaker page renders.
- `apps/web/e2e/attendee-language-pick.spec.ts` — attendee page renders.

## Related

- [Realtime Translation](realtime-translation.md)
- [Transcripts & Captions](transcripts-and-captions.md)
- [Glossary](glossary.md)
- [Event Archive](event-archive.md)
