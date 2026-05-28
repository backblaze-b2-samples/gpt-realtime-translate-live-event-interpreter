<!-- last_verified: 2026-05-28 -->
# Transcripts & Captions

## Purpose

Turn the stream of `TranscriptChunk`s emitted by the Realtime session into persisted artifacts under each event prefix:

- `events/<id>/source-transcript.txt` + `.vtt` for the source-language transcript
- `events/<id>/<bcp47>/transcript.txt` for the flat per-language transcript
- `events/<id>/<bcp47>/captions.vtt` for WebVTT cues
- `events/<id>/<bcp47>/captions.srt` for SubRip cues

## Inputs

`TranscriptChunk` (typed in `services/api/app/types/transcript.py`):

```python
TranscriptChunk(
    event_id="keynote-2026",
    lang="es",
    start_ms=1200,
    end_ms=1800,
    text="Hola, mundo.",
    is_final=True,
)
```

## Outputs

`CaptionCue` list serialized to:

- VTT — `HH:MM:SS.mmm --> HH:MM:SS.mmm` separator, blank-line per cue, `WEBVTT` header.
- SRT — `HH:MM:SS,mmm --> HH:MM:SS,mmm` separator, 1-indexed cue index, blank-line per cue.
- TXT — one cue per line, no timestamps. Useful for grep / search / quote pulls.

## Flow

1. `service.realtime_session.EventBroadcast` receives chunks from the Realtime session.
2. Chunks accumulate in-memory per language.
3. On every Nth final chunk (or on the speaker disconnect), `service.transcripts.persist_chunks(event_id, lang, chunks)` writes the current cue list to B2.
4. Interim chunks (`is_final=False`) drive the live caption preview but are never persisted.

## Persistence cadence

- Every 30 seconds of final cues, persist incrementally. This bounds the worst-case data loss on a mid-event disconnect to one rotation window.
- On clean shutdown, one final flush — guarantees the on-disk transcript matches the last chunk emitted by the model.

## Edge cases

- **Out-of-order chunks**: `chunks_to_cues` sorts by `start_ms` before emitting the index. A late-arriving chunk doesn't break VTT.
- **Empty chunk list**: `persist_chunks` short-circuits with no B2 call. Safe to call defensively from `finally:` blocks.
- **Stream ends mid-cue**: the unfinalized chunk is dropped; the persisted transcript ends at the last final cue.

## Tests

- The scaffold ships unit tests via the structural suite. Cue-list correctness lands in the follow-up exec plan together with the Realtime wiring.

## Related

- [Live Interpretation](live-interpretation.md)
- [Realtime Translation](realtime-translation.md)
- [Event Archive](event-archive.md)
