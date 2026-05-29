<!-- last_verified: 2026-05-28 -->
# Architecture

## Components

- **apps/web/** — Next.js 16 frontend (App Router, Tailwind v4, shadcn/ui)
  - Dashboard with event-aware stats (total events, total interpretation minutes, live now, peak attendees), activity chart, recent events table
  - **Events** (`/events`) — `EventCard` grid scoped to the `events/` prefix; status badge, source language, target-language chips, attendee peak
  - **Event detail** (`/events/[id]`) — source-audio playback, side-by-side per-language transcripts, VTT/SRT/TXT downloads
  - **Live speaker console** (`/live`) — placeholder until the OpenAI Realtime wiring lands; will request mic permission, open WebSocket at `/events/{id}/speaker`, stream source audio, render live caption preview + attendee count
  - **Attendee listen** (`/live/[id]/listen`) — placeholder; will open `/events/{id}/listen?lang=<bcp47>` and render translated audio + caption overlay
  - **Glossary** (`/glossary`) — list / create / edit JSON glossaries stored under `glossaries/<id>.json`
  - **Files** (`/files`) — full B2 bucket explorer (tree view, preview, download, delete) — non-negotiable keep
  - Dark mode via `next-themes`
- **services/api/** — FastAPI backend (layered architecture)
  - REST API for events, glossaries, files, presigned URLs
  - WebSocket routes for speaker / attendee
  - B2 S3 integration via boto3
  - OpenAI Realtime integration containment-wrapped behind `OpenAIRealtimeSession`
  - Audio metadata extraction post-event (`.wav` via stdlib `wave`, everything else via `mutagen` — no ffmpeg)
  - Health check endpoint with B2 connectivity verification
  - Structured JSON logging with request tracing
  - Prometheus-format metrics endpoint (events started/ended, attendees joined, realtime chunks)
- **packages/shared/** — TypeScript type definitions
  - Mirrors Pydantic models from the API (`Event`, `EventArtifact`, `Glossary`, `FileMetadata`, `EventStats`, …)
  - Consumed by `apps/web/` as a workspace dependency

## External Services

- **Backblaze B2 S3 API** — event archive (source audio, transcripts, captions, optional translated audio, glossaries), presigned URLs
- **OpenAI Realtime API (`gpt-realtime-translate`)** — live multi-language translation; brokered exclusively through `services/api/app/repo/openai_realtime.py`

## Backend Layering

The API follows a strict layered architecture:

```
types/     Pydantic models — no logic, no imports from other layers
  |
config/    Settings (pydantic-settings) — depends only on types
  |
repo/      Data access (boto3 B2 client + OpenAI Realtime adapter)
  |
service/   Business logic — calls repo, returns types
  |
runtime/   FastAPI routes + WebSocket handlers — calls service, never repo directly
```

### Layering Rules

1. Dependencies flow downward only: `types` -> `config` -> `repo` -> `service` -> `runtime`
2. No backward imports (e.g., service must not import from runtime)
3. `boto3` only allowed in `repo/` layer
4. **`openai` only allowed in `repo/openai_realtime.py`**
5. WebSocket handlers (`runtime/live.py`) must call into the service layer; they may not import from `repo/`
6. All boundary data uses Pydantic models (no raw dicts across layers)
7. Each file stays under 300 lines

### Directory Structure

```
services/api/
  main.py                  App entrypoint, middleware, router registration
  app/
    types/                 Pydantic models (Event, EventArtifact, Glossary, TranscriptChunk, …)
    config/                Settings loaded from environment
    repo/                  B2 S3 client + OpenAI Realtime adapter
                             - b2_client.py        generic file helpers
                             - b2_events.py        events/ + glossaries/ prefix helpers
                             - openai_realtime.py  ONLY allowed openai import
    service/               Business logic — events, realtime_session, transcripts, glossary, audio_metadata, files
    runtime/               FastAPI route handlers + WS handlers — events, live, glossary, files, health, metrics
  tests/                   pytest tests (structural + integration)
```

## Boundary Invariants

- **No external SDK leakage**: `boto3` is only imported in `app/repo/`. `openai` is only imported in `app/repo/openai_realtime.py`. All other layers interact through the repo interface.
- **No raw dicts at boundaries**: All data crossing layer boundaries uses typed Pydantic models.
- **No mutable globals**: Configuration is read-only after init. Active broadcast sessions are tracked in a process-local dict that needs to move into shared state for multi-instance deployments (documented in RELIABILITY.md).
- **Validated inputs**: All HTTP inputs validated by FastAPI/Pydantic. Event ids validated against `^[A-Za-z0-9_-]{6,64}$` with explicit `..` / `//` rejection. Language codes validated against the BCP-47-flavored `LANG_RE` before any B2 call.
- **Custom user agent**: every `boto3.client("s3", …)` sets `Config(user_agent_extra="b2ai-gpt-realtime-translate-live-event-interpreter")`. No `b2-native` calls.

## Deployment

- **Local dev** — `pnpm dev` runs both services via `concurrently`
  - Web: `localhost:3000`
  - API: `localhost:8000`
- **Railway** — two services from the same repo
  - See `infra/railway/README.md` for configuration

## Data Stores

- **Backblaze B2** — object storage (S3-compatible API)
  - Events under the `events/` prefix; the Events grid lists this prefix
  - Glossaries under the `glossaries/` prefix; one JSON object per glossary
  - File listing and metadata via S3 `list_objects_v2` / `head_object`
  - No application database — B2 is the sole data store

## Storage Layout

```
events/<event-id>/event.json                 — manifest (status, languages, timestamps)
events/<event-id>/source.<wav|ogg|opus>      — source audio (always archived)
events/<event-id>/source-transcript.txt
events/<event-id>/source-transcript.vtt
events/<event-id>/<bcp47>/transcript.txt
events/<event-id>/<bcp47>/captions.vtt
events/<event-id>/<bcp47>/captions.srt
events/<event-id>/<bcp47>/audio.<wav|opus>   — optional, per-language opt-in (default off)

glossaries/<glossary-id>.json
```

## Trust Boundaries

See [docs/SECURITY.md](docs/SECURITY.md) for full security documentation.

- **Frontend -> API** — CORS-restricted to configured origins
- **API -> B2** — authenticated via application keys, signature v4
- **API -> OpenAI** — authenticated via `OPENAI_API_KEY`, never leaked to the browser
- **Client -> B2** — presigned URLs for playback (inline) and download (attachment); 10-min expiry
- **WebSocket connections** — speaker socket gated by a session token issued by the speaker page; attendee sockets validate event id and language before any chunk is forwarded

## Data Flows

- **Create event**: Browser -> `POST /events` -> service validates id/languages -> repo writes `events/<id>/event.json` -> response
- **List events**: Browser -> `GET /events` -> service enumerates `events/` common prefixes -> HEADs each manifest in parallel -> returns sorted-by-created-at
- **Speaker live**: Browser opens `WS /events/{id}/speaker` -> service registers an `EventBroadcast`, marks the manifest `live`, and opens one `OpenAIRealtimeSession` per target language (websockets to `/v1/realtime/translations`) -> speaker page streams 24 kHz PCM16 in -> each session emits translated audio + transcript back -> service fans out to per-language attendee queues + a speaker caption monitor -> transcripts persist on a cadence; on close it writes `source.wav` and flips the manifest to `ended`
- **Attendee listen**: Browser opens `WS /events/{id}/listen?lang=<bcp47>` -> service joins the broadcast's per-language queue -> chunks stream to the browser; on disconnect the queue is dropped
- **Playback**: Browser -> `GET /events/{id}/source-audio` -> service validates id -> repo generates inline presigned URL -> browser renders `<audio controls>`
- **Transcript / caption download**: Browser -> `GET /events/{id}/transcript?lang=...` or `/captions?lang=...&fmt=vtt|srt` -> repo generates presigned URL with `Content-Disposition: attachment`
- **Delete event**: Browser -> `DELETE /events/{id}` -> service validates id -> repo cascades a batched `DeleteObjects` over the entire `events/<id>/` prefix -> TanStack Query invalidates events + stats
- **Bucket explorer**: Browser -> `GET /files` -> service calls repo with empty prefix -> returns full bucket tree

## Observability

- Structured JSON logging on all requests with `request_id`; event-aware fields (`event_id`, `target_lang`) where applicable
- Request timing middleware (logs duration per request)
- `/metrics` endpoint (Prometheus format: request count, latency, events started/ended, attendees joined, realtime chunks broadcast)
- `/health` endpoint (B2 connectivity check)

## Canonical Files

- Event route handlers: `services/api/app/runtime/events.py`
- WebSocket handlers: `services/api/app/runtime/live.py`
- Glossary route handlers: `services/api/app/runtime/glossary.py`
- Event lifecycle service: `services/api/app/service/events.py`
- Realtime session driver: `services/api/app/service/realtime_session.py`
- Transcript / caption accumulator: `services/api/app/service/transcripts.py`
- Glossary service: `services/api/app/service/glossary.py`
- Audio metadata extractor: `services/api/app/service/audio_metadata.py`
- B2 data access (repo layer): `services/api/app/repo/b2_client.py`, `services/api/app/repo/b2_events.py`
- OpenAI containment wrapper: `services/api/app/repo/openai_realtime.py`
- Pydantic models: `services/api/app/types/` (`events.py`, `transcript.py`, `glossary.py`, `files.py`, `stats.py`, `formatting.py`)
- Config (pydantic-settings): `services/api/app/config/settings.py`
- Structural tests: `services/api/tests/test_structure.py`
- Frontend API client: `apps/web/src/lib/api-client.ts`
- Events UI: `apps/web/src/components/events/{event-card,events-view,waveform}.tsx`
- Shared TypeScript types: `packages/shared/src/types.ts`

## Core Features

- [Event Archive](docs/features/event-archive.md)
- [Live Interpretation](docs/features/live-interpretation.md)
- [Realtime Translation](docs/features/realtime-translation.md)
- [Transcripts & Captions](docs/features/transcripts-and-captions.md)
- [Glossary](docs/features/glossary.md)
- [Bucket Explorer](docs/features/file-browser.md)
- [Dashboard](docs/features/dashboard.md)
- [Audio Metadata Extraction](docs/features/audio-metadata.md)
- [Source-Audio Playback](docs/features/audio-playback.md)

## References

- [docs/SECURITY.md](docs/SECURITY.md) — security principles and implementation
- [docs/RELIABILITY.md](docs/RELIABILITY.md) — reliability expectations
- [AGENTS.md](AGENTS.md) — architectural invariants and agent instructions
