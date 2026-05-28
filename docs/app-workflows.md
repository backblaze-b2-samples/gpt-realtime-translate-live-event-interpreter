<!-- last_verified: 2026-05-28 -->
# App Workflows

End-to-end user journeys through the GPT-Realtime-Translate Live Event Interpreter. Three personas: speaker, attendee, organizer.

## Speaker — start a live event

1. Open `/live`.
2. Fill in title, source language, and target languages. Optionally attach a glossary from the glossary picker (lists every doc under `glossaries/`).
3. Toggle "Persist translated audio?" per target language (default off). Captions and transcripts are always archived.
4. Click **Go live**. The browser:
   - Calls `POST /events` to create the event (`event.json` lands in B2).
   - Requests microphone permission.
   - Opens a WebSocket to `/events/{id}/speaker`, sends the session config frame, then begins streaming PCM source-audio chunks.
5. The page shows the live caption preview, target-language chips, and the current attendee count.
6. On stop, the page closes the WebSocket. The backend finalizes per-language transcripts, source transcript, and (if enabled) translated audio. The event manifest flips to `status=ended` and `duration_ms` populates.

> Scaffold note: the speaker UI is a placeholder until the OpenAI Realtime wiring lands. Opening the speaker WebSocket today returns a structured "not yet implemented" close frame; the layering test still passes.

## Attendee — join and listen

1. Get the event link from the speaker (typically `https://<host>/live/<id>/listen`).
2. Open `/live/<id>/listen`. The page renders a language picker populated from the event's target list. If the requested `?lang=` is unsupported, the page falls back to the source language and surfaces an inline notice.
3. Click **Listen**. The browser opens a WebSocket to `/events/{id}/listen?lang=<bcp47>`.
4. Translated audio plays inline through a `<audio>` element fed by MediaSource. Captions overlay the player with the live transcript stream.
5. On disconnect, the page closes the WebSocket and the backend drops the attendee from the broadcast queue (no impact on other attendees).

## Organizer — browse the archive

1. Open `/` to see the dashboard: total events, total interpretation minutes, live-now count, peak concurrent attendees, plus a daily activity chart and recent-events table.
2. Open `/events` to see every archived event as a grid of `EventCard`s. Status badge, source language, target chips, attendee peak.
3. Click an event to open `/events/[id]`. From there:
   - Press **Play** to listen to the archived source audio (presigned, 10-min expiry, inline disposition).
   - Download the source transcript or per-language transcripts (TXT) and captions (VTT / SRT) — each download is a presigned URL with `Content-Disposition: attachment`.
   - Browse the artifact listing under `events/<id>/` to verify what's in B2.
4. Open `/glossary` to manage reusable glossaries. Each glossary is a single JSON document at `glossaries/<id>.json` — list / create / edit / delete via the UI or `POST /glossaries` directly.
5. Open `/files` for ops-style browsing of the entire bucket, including non-event objects.

## Trust boundaries at a glance

- The speaker socket carries a session token issued by `POST /events`. Without it, the connection is closed.
- Attendee sockets validate the event id and language before any chunk is forwarded — no broadcast is opened against an invalid id.
- All B2 access flows through presigned URLs from the API; the browser never sees the B2 application key.
- The OpenAI API key never leaves the backend.

See [docs/SECURITY.md](SECURITY.md) for the full security model.
