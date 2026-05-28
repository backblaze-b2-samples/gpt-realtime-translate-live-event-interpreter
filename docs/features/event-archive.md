<!-- last_verified: 2026-05-28 -->
# Event Archive

## Purpose

Surface every live-interpretation event as a browsable archive in the UI, backed by a single B2 prefix per event. Two pages:

- `/events` — grid of `EventCard`s; sample-specific Library equivalent.
- `/events/[id]` — single-event detail view: source audio playback, per-language transcripts / captions, artifact listing.

## Inputs

- `GET /events?limit=<n>` — paged enumeration of events
- `GET /events/{id}` — manifest + artifact listing for one event
- `DELETE /events/{id}` — cascade-delete every artifact under `events/<id>/`
- `GET /events/{id}/source-audio` — inline presigned URL for the source recording
- `GET /events/{id}/transcript[?lang=<bcp47>]` — attachment presigned URL for `source-transcript.txt` (no `lang`) or `<lang>/transcript.txt`
- `GET /events/{id}/captions?lang=<bcp47>&fmt=vtt|srt` — attachment presigned URL for captions

## Outputs

JSON shapes mirror the Pydantic models in `services/api/app/types/events.py`:

- `Event` — manifest + artifact list
- `EventArtifact` — single B2 object (kind / lang / size / content type / created_at)
- `EventStatus` — `scheduled` | `live` | `ended`

## Storage layout

```
events/<event-id>/event.json                 — manifest (status, languages, timestamps)
events/<event-id>/source.<wav|ogg|opus>      — source audio (always archived)
events/<event-id>/source-transcript.txt
events/<event-id>/source-transcript.vtt
events/<event-id>/<bcp47>/transcript.txt
events/<event-id>/<bcp47>/captions.vtt
events/<event-id>/<bcp47>/captions.srt
events/<event-id>/<bcp47>/audio.<wav|opus>   — optional, per-language opt-in (default off)
```

## Flow

1. Frontend `/events` page calls `useEvents()` -> `getEvents()` -> `GET /events`.
2. Backend service enumerates `events/` common prefixes via `ListObjectsV2(Delimiter='/')`.
3. For each event id, HEADs `event.json` in parallel via `head_event_artifacts_parallel`.
4. Reads each manifest, hydrates an `Event`, sorts by `created_at` desc, slices to `limit`.

For the detail page:

1. `useEvent(id)` -> `getEvent(id)` -> `GET /events/{id}`.
2. Service lists every object under `events/<id>/`, classifies each one (`source-audio`, `source-transcript`, `captions[<lang>]`, `transcript[<lang>]`, `translated-audio[<lang>]`, `manifest`), and combines with the manifest.

## Edge cases

- **Orphan prefix** (no `event.json`): the events list still surfaces the id with `status=ended` and an empty target list. The detail page renders a "manifest missing" placeholder with the raw artifact listing intact.
- **Malformed event id** in the URL: the runtime layer rejects with 400 before any B2 call.
- **Concurrent delete during list**: the parallel HEAD silently drops 404s rather than failing the request.

## Tests

- `services/api/tests/test_events.py::test_list_events_empty` — empty bucket returns `[]`.
- `services/api/tests/test_events.py::test_list_events_returns_manifest` — manifest hydration round-trip.
- `services/api/tests/test_events.py::test_create_event_persists_manifest` — `POST /events` writes `event.json`.
- `services/api/tests/test_error_handling.py::test_event_id_traversal_is_rejected` — malformed id 400.
- `apps/web/e2e/events-list.spec.ts` — empty-state copy.

## Related

- [Live Interpretation](live-interpretation.md)
- [Transcripts & Captions](transcripts-and-captions.md)
- [Source-Audio Playback](audio-playback.md)
- [Bucket Explorer](file-browser.md)
