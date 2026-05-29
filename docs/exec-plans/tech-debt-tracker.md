<!-- last_verified: 2026-05-28 -->
# Tech Debt Tracker

Known tech debt items. Agents update this when they discover or create tech debt.

| Description | Impact | Proposed Resolution | Priority | Status |
|---|---|---|---|---|
| `datetime.utcnow()` deprecated in Python 3.12+ | Naive datetimes, future breakage | Replace with `datetime.now(UTC)` in `repo/b2_client.py` and (historically) `service/metadata.py` — that module was replaced by `service/audio_metadata.py` during the audio-starter-kit refit; the equivalent `datetime.now(UTC)` usage is preserved | High | Resolved |
| S3 client recreated on every API call | Connection pool wasted, added latency | Cache client as module-level singleton via `lru_cache` | High | Resolved |
| `get_upload_stats()` pagination broken at 1000 objects | Stats silently wrong for large buckets | Check `IsTruncated` + use `ContinuationToken` | High | Resolved |
| `record_upload()` never called | `/metrics` always reports 0 uploads | Call from `runtime/upload.py` after successful upload | Medium | Resolved |
| Metrics counters not thread-safe | Race conditions under concurrent requests | Use `threading.Lock` (matches `service/files.py` pattern) | Medium | Resolved |
| `_humanize_bytes` duplicated in Python (repo + service) | DRY violation, drift risk | Extract to `app/types/formatting.py` shared util | Medium | Resolved |
| `humanizeBytes` duplicated in TypeScript | DRY violation | Extract to `lib/utils.ts` | Low | Open |
| `formatDate` duplicated in TypeScript | DRY violation | Extract to `lib/utils.ts` | Low | Open |
| No test harness for feature specs | No automated verification | Add pytest fixtures + test files per feature | Medium | Resolved (partial — tests added for upload, files, activity, errors) |
| `service.transcripts.persist_chunks` is implemented but never called | VTT/SRT writers and the B2 path exist, but no caller drives them — the dashboard "transcripts" UI will render empty until a producer wires in. | Invoke from `service.realtime_session` on the periodic-flush cadence + the speaker-socket close path. Lands with the OpenAI Realtime adapter. | Medium | Resolved (`realtime_session` flushes every 15 s + on close; covered by `tests/test_realtime.py`) |
| Glossary biasing not applied to the translate session | `glossary_terms` is plumbed through `OpenAIRealtimeSession` but never sent upstream — the `gpt-realtime-translate` model auto-detects source and takes no system prompt, so attached glossaries don't influence translation today. | Investigate per-session vocabulary/biasing options on the translations endpoint; apply attached glossary terms when supported. | Medium | Open |
| Upstream realtime session has no reconnect/backoff | A transient drop of an `OpenAIRealtimeSession` ends that language's translation for the rest of the event. | Add bounded exponential-backoff reconnect in the adapter (persist transcript at each retry boundary). | Low | Open |
| `service.files.get_event_activity` only buckets today's events | Last 7 days chart shows today's count and zeros for earlier days. | Page through each event's `event.json` manifest once (cap at `EVENT_ACTIVITY_LOOKBACK_DAYS`), HEAD-attribute by `created_at`. | Low | Open |
| `docs/images/events.png` screenshot is the starter kit's library view | Visual mismatch — the README references events but the image was captured against the old `/library` UI. | Capture a fresh screenshot of `/events` once the realtime adapter lands and there's seeded data to display. | Low | Open |
