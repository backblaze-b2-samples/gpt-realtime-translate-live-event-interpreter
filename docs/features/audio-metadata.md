<!-- last_verified: 2026-05-28 -->
# Feature: Audio Metadata Extraction

## Purpose

Read duration, sample rate, channels, bit depth, and codec from the **source audio archived at the end of each live event** (`events/<id>/source.<wav|ogg|opus>`). Pure-Python: stdlib `wave` for uncompressed WAV, `mutagen` for everything else. No ffmpeg dependency.

## When it runs

Post-event, not during the live stream. When the speaker disconnects and the source recording is finalized, the service layer calls `service.audio_metadata.extract_metadata()` and stamps the result onto the event manifest (`duration_ms` field) so the dashboard's "Interpretation Minutes" tile and the per-event detail view both have accurate numbers without re-reading the audio bytes on every request.

## Inputs

- Raw bytes of the source recording (typically WAV 16-bit / 16 kHz mono written by the speaker page).
- Original filename / suggested extension.
- Declared content type.

## Outputs

`FileMetadataDetail` (defined in `services/api/app/types/files.py`):

- `duration_ms: int | None`
- `sample_rate: int | None`
- `channels: int | None`
- `bit_depth: int | None`
- `codec: str | None`

Any value is allowed to be `null` — partial metadata is better than failing the event finalization because of an unusual encoder.

## Edge cases

- **Mid-event abort with no recording yet** — finalization skips the extraction step entirely; the manifest carries `duration_ms = null`.
- **Unsupported container** — `mutagen` raises; the extractor swallows the exception, logs a warning, and returns nulls.
- **Corrupt header** — same handling.

## Related

- [Event Archive](event-archive.md)
- [Source-Audio Playback](audio-playback.md)
