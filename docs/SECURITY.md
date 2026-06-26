<!-- last_verified: 2026-06-26 -->
# Security

Security principles and implementation for the gpt-realtime-translate-live-event-interpreter.

## Trust Boundaries

- **Frontend -> API**: CORS-restricted to configured origins, scoped to `GET/POST/DELETE/OPTIONS`
- **API -> B2**: Authenticated via `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY`, signature v4
- **API -> OpenAI**: Authenticated via `OPENAI_API_KEY`; the key never leaves the backend
- **Client -> B2**: Presigned URLs for inline playback (10-min expiry) and attachment download (10-min expiry, `Content-Disposition: attachment`)
- **WebSocket connections**: Speaker socket carries a server-issued session token; attendee sockets validate event id + language before any chunk is forwarded

## Event ID Validation

- Validated against `^[A-Za-z0-9_-]{6,64}$` at the API boundary (`service.events.EVENT_ID_RE`)
- Explicit `..` and `//` rejection before any B2 call — mirrors the audio-key pattern from the parent starter
- Language codes validated against the BCP-47-flavored `service.events.LANG_RE`
- Glossary ids validated against `^[A-Za-z0-9_-]{3,64}$` (`service.glossary.GLOSSARY_ID_RE`)

## File Key Validation

- Empty keys rejected
- Path traversal patterns rejected (`../`, `%2e%2e`, backslashes, null bytes)
- The bucket is the only access boundary — add prefix scoping in
  `services/api/app/service/files.py::validate_key` if your deployment
  shares a bucket with other workloads

## Speaker / attendee gating

- The speaker WebSocket only accepts the first frame as a typed session config. Anything else closes the connection with code `4002`.
- Attendees connect with `?lang=<bcp47>`. Languages not on the event's target list close with code `4002`.
- The follow-up exec plan adds a server-issued session token to the speaker socket; the attendee socket already gates on the event id + language pair.

## OpenAI API key handling

- Loaded once at startup via `pydantic-settings`.
- Surfaced only inside `services/api/app/repo/openai_realtime.py`, where it authenticates the realtime translations websocket; no other module contacts OpenAI's realtime API.
- Never echoed in logs (the JSON formatter writes only the field names exposed on `LogRecord`).
- Missing at startup -> the API logs a warning and the speaker socket closes with a structured `4001` frame; the rest of the app stays functional.

## Download Safety

- Presigned URLs for transcripts and captions force `Content-Disposition: attachment`.
- Source-audio presign uses no `Content-Disposition` so the browser plays inline; this is safe because the source audio is user-controlled (the speaker) and would have to upload a malicious payload to themselves to exploit.
- Attendee `<audio>` elements should be served with a Content-Security-Policy header that restricts `media-src` to the B2 endpoint host plus `blob:` (for the MediaSource fallback).

## Secrets Management

- All secrets loaded via environment variables (pydantic-settings)
- Never committed to source control
- `.env.example` documents required variables without values

## Agent Security Rules

- Never commit `.env`, credentials, or API keys
- Never weaken validation without explicit instruction
- Never bypass CORS, auth, or input sanitization
- Always validate at system boundaries
- Never import `openai` outside `app/repo/openai_realtime.py`
