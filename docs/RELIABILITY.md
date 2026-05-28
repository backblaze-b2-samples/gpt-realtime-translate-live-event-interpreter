<!-- last_verified: 2026-05-28 -->
# Reliability

Reliability expectations and practices for this project.

## Health Checks

- `GET /health` verifies B2 connectivity and returns `healthy` or `degraded`
- Health endpoint is always available, even when B2 is down

## Error Handling

- HTTP handlers return structured error responses with appropriate status codes
- WebSocket handlers close with structured frames (`{type, code, reason}`) the frontend can branch on; close codes live in the application-level 4xxx range
- External service failures (B2, OpenAI) are caught and surfaced as 500/503 responses or close frames
- No unhandled exceptions leak stack traces to clients

## Logging

- Structured JSON logging via Python stdlib
- Every request gets a `request_id` for tracing
- Event-aware fields (`event_id`, `target_lang`) are added by the logger formatter when present on the `LogRecord`
- Log levels: ERROR for failures, WARNING for degraded state, INFO for requests

## Observability

- Request timing middleware logs duration for every request
- `/metrics` endpoint exposes Prometheus-format counters:
  - `http_requests_total`
  - `http_request_duration_seconds`
  - `events_started_total` / `events_ended_total`
  - `attendees_joined_total`
  - `realtime_chunks_total`

## Realtime session resilience

- **Reconnect** — on transient upstream disconnect, the service layer retries the OpenAI Realtime connection with exponential backoff (1s, 2s, 4s, …, capped at 30s) for up to N attempts before tearing down the broadcast.
- **Partial transcript persistence on disconnect** — `service.transcripts.persist_chunks` runs every 30 seconds of final cues and from the disconnect handler's `finally:` block. Worst-case loss is bounded to one rotation window.
- **Single-instance state** — the `_active` broadcast registry in `service.realtime_session` is process-local. Multi-instance deployments need to move this into shared state (Redis, Postgres LISTEN/NOTIFY) before they can route attendees that connect to a different replica than the speaker. This is the canonical "do not deploy live interpretation behind a non-sticky load balancer" footgun.

## Graceful Degradation

- Events listing returns empty list (not error) when B2 has no `events/` prefixes
- Glossary listing skips malformed JSON documents and logs a warning rather than failing the whole call
- Audio metadata extraction failures don't block event finalization (manifest carries `duration_ms = null`)
- Missing `OPENAI_API_KEY` surfaces a startup warning; the rest of the app (events explorer, archive, files, glossary) stays operational
- Frontend shows skeleton states while loading, error states on failure

## Lifecycle hooks (recommended)

- Lifecycle policy on the `events/` prefix to auto-purge `ended` events after N days (e.g. 30) is *not* configured at scaffold time; see the [Backblaze B2 docs on lifecycle rules](https://www.backblaze.com/docs/cloud-storage-lifecycle-rules?utm_source=github&utm_medium=referral&utm_campaign=ai_artifacts&utm_content=b2ai-gpt-realtime-translate-live-event-interpreter) to wire one up.
- For high-traffic events, consider CDN-fronting the source audio + caption files (the URLs are already presignable, but a CDN cache layer reduces direct B2 GETs).

## Deployment

- Railway health checks on `/health`
- Zero-downtime deploys via rolling updates
- Environment-specific configuration via env vars (no config files in prod)
- Sticky session routing required for the live-interpretation WebSocket pair
