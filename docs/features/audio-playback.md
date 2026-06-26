<!-- last_verified: 2026-05-28 -->
# Feature: Source-Audio Playback

## Purpose

Play the archived source audio of a past event directly from B2 in the browser, without proxying bytes through the API. The single-event detail page swaps its **Play** button for a native `<audio controls>` element fed by a short-lived presigned URL.

## Used By

- UI: `/events/[id]` — source-audio card
- API: `GET /events/{id}/source-audio`

## Flow

1. User clicks **Play** on the event-detail page.
2. Browser calls `getEventSourceAudioUrl(id)` -> `GET /events/{id}/source-audio`.
3. Backend resolves the source audio key (tries `source.wav`, then `.ogg`, then `.opus`) and returns a presigned URL via `repo.presign_event_playback(key, expires_in=600)`.
4. Browser sets `audio.src = url` and the native player handles streaming.

## Presigning details

- 10-minute expiry — long enough for a curious organizer to scrub through the whole recording, short enough that a leaked URL stops working soon.
- Inline `Content-Disposition` (none set) — the browser plays in place rather than offering a download dialog.
- The transcript / caption endpoints use `presign_event_download` instead, which sets `attachment` so the file lands in the user's Downloads folder.

## Edge cases

- **No source audio** — service raises `EventNotFound(detail="Source audio not available")` → 404. UI shows the artifact list so the organizer can investigate.
- **Expired URL during playback** — the user clicks Play again to refresh.
- **Public bucket configured (`B2_PUBLIC_URL_BASE`)** — the public URL is surfaced alongside the presigned one in the manifest; the UI prefers the presigned URL because of the expiry guarantee.

## Related

- [Event Archive](event-archive.md)
- [Audio Metadata Extraction](audio-metadata.md)
