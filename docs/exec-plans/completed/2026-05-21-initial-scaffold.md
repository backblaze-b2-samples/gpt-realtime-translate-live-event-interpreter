<!-- last_verified: 2026-05-21 -->
# 2026-05-21 — Initial scaffold from vibe-coding-starter-kit

Scaffolded `gpt-realtime-translate-live-event-interpreter` from the `vibe-coding-starter-kit` template
under the orchestration of the `new-sample` skill. The full plan (architectural
delta, rename table, doc transforms, B2-compliance deltas) lives in
`.claude/scratch/new-sample-bbe9e126-5386-49d7-bdf1-1581fda52d86.md` and was
applied verbatim.

## What changed (high level)

- Identifier rename `vibe-coding-starter-kit` -> `gpt-realtime-translate-live-event-interpreter`
  across every text file in the tree (excluding `node_modules`, `.next`,
  `dist`, `build`, `.venv`).
- Workspace packages: `@gpt-realtime-translate-live-event-interpreter/{shared,web}`.
- Custom user agent set on the only S3 client to
  `b2ai-gpt-realtime-translate-live-event-interpreter`.
- `.env.example` now includes `B2_REGION` (the source template was
  missing it).
- Replaced `service/metadata.py` (image/PDF) with
  `service/audio_metadata.py` (stdlib `wave` + `mutagen`). Python deps:
  out `Pillow` / `PyPDF2`, in `mutagen`.
- Added the audio Library: `/library` page, `LibraryView`,
  `AudioAssetCard`, `Waveform`, `runtime/library.py`,
  `service/library.py`, `types/library.py`, `repo` helpers for the
  `audio/` prefix.
- Dashboard tiles re-shaped to audio metrics
  (`total_audio_assets`, `total_duration_ms`).
- Files (`/files`) kept as the full-bucket explorer. Final left-nav
  order (Dashboard -> Upload -> Library -> Files -> Settings) was set
  by the user after the scaffold; Design System sits alone in the
  Reference group below.
- Removed `docs/images/*.png` placeholders; README references removed.
- Replaced README, AGENTS.md, ARCHITECTURE.md, app-workflows.md, and
  most feature docs with audio-aware copy. Added `docs/features/audio-library.md`,
  `docs/features/audio-metadata.md`, `docs/features/audio-playback.md`.
- Added the `AudioAssetCard` showcase to `/design` and a matching section
  in `docs/design-system.md`.

## Out of scope (deliberate)

- New e2e tests (Playwright harness kept; existing tests pass).
- Real screenshots (no binary asset creation per skill rules).
- Concrete TTS / STT / music-gen integration (this is a template).
- Persisting audio metadata as S3 object metadata so the Library list
  endpoint can return `duration_ms` / `sample_rate` without HEADing every
  asset. Tracked as future work — the wire-up on the UI and dashboard is
  ready as soon as the field is populated.
