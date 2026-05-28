# Plan: Audio-First Dashboard

> **Status**: Partially complete. Backend + one frontend tile shipped. Frontend
> changes #2/#4/#5/#6 + docs/tests/lint cleanup remain. This file is a handoff;
> read it top-to-bottom before touching anything.

## Why

The dashboard at `apps/web/src/app/page.tsx` was inherited verbatim from the
generic starter kit. For an audio-first kit it had three concrete problems:

1. **"Total Duration" was hardcoded to `0`** in `service/library.py::get_audio_aggregates`
   — visually it shouted "0:00" forever.
2. **The Recent Uploads table is file-generic** — uses `useFiles` (full bucket),
   `mimeToLabel` with Image/PDF/CSV branches, and a Status column that always
   says "Complete". Nothing audio.
3. **No audio-specific signal** — no format breakdown, no minutes-added trend,
   no inline play, no storage size; "Total Downloads" sits where Storage should.

The user's goal: make the dashboard feel like a kit for audio in small,
non-breaking steps. No DB introduced — audio metadata is persisted as S3
user metadata (`x-amz-meta-*`) on the object itself, read back with HEADs.

## Done (do NOT redo)

### Backend — duration + formats + storage

- `services/api/app/repo/b2_client.py::upload_file`: accepts `metadata: dict[str, str] | None`,
  forwarded to `put_object` as `Metadata=...`. ASCII-only strings.
- `services/api/app/repo/b2_audio.py` (new file): extracted all audio-prefix
  helpers from `b2_client.py` so the latter stays under the 300-line limit.
  Adds `head_audio_objects_parallel(keys, max_workers=10)` using
  `ThreadPoolExecutor`. Re-exported via `app/repo/__init__.py`.
- `services/api/app/service/audio_metadata.py`:
  - `S3_AUDIO_META_KEYS` constant (`"duration-ms"`, `"sample-rate"`, `"channels"`,
    `"bit-depth"`, `"codec"`).
  - `to_s3_metadata(detail) -> dict[str, str]`: serializes only non-None fields.
- `services/api/app/service/upload.py::process_upload`: extracts metadata BEFORE
  uploading, passes the serialized dict to `upload_file` only when `is_audio`.
- `services/api/app/service/library.py`:
  - `_int_or_none`, `_metadata_from_head`, refactored `_asset_from_object` to
    optionally take a head response.
  - `list_audio_assets(limit, with_metadata=True)`: HEAD-fanout to populate
    duration/sample_rate/channels/bit_depth/codec on list responses.
  - `get_audio_aggregates()`: sums real `total_duration_ms`, returns
    `formats: dict[str, int]` keyed by extension.
- `services/api/app/service/files.py`:
  - `get_stats()`: forwards `audio_size_bytes`, `audio_size_human`, `formats` from aggregates.
  - `get_upload_activity()`: switched from `list_files` to `list_audio_objects`
    (audio-only) and sums `duration_ms` per day via parallel HEAD.
- `services/api/app/types/stats.py`: `UploadStats` gained `audio_size_bytes`,
  `audio_size_human`, `formats`. `DailyUploadCount` gained `duration_ms` (default 0).

### Frontend — Audio Storage tile

- `packages/shared/src/types.ts`: `UploadStats` + `DailyUploadCount` updated to match.
- `apps/web/src/components/dashboard/stats-cards.tsx`: "Total Downloads" tile
  replaced by "Audio Storage" rendering `stats.audio_size_human`. Icon
  `Download` swapped for `Database`.

### Backend tests — updated to match

- `services/api/tests/test_upload_conflict.py`: stub now accepts `metadata=None` kwarg.
- `services/api/tests/test_upload_activity.py`: rewritten — stubs
  `list_audio_objects` + `head_audio_objects_parallel` instead of `list_files`,
  asserts both `uploads` and `duration_ms` per day.
- `services/api/tests/test_download_stats.py`: `get_audio_aggregates` stub now
  includes `formats: {}`.

Backend state: `pnpm test:api` → **24/24 pass**, `pnpm check:structure` →
**4/4 pass**.

## Remaining work

### 1. Recent Uploads → audio-first table

**File**: `apps/web/src/components/dashboard/recent-uploads-table.tsx`

- Replace `useFiles("", 10)` with `useLibrary(10)` (already exists in `lib/queries.ts`).
- Drop `mimeToLabel` entirely.
- New columns: **Filename / Duration / Format / Date / ▶ Play**. Drop the
  "Status" column (always "Complete" — pure decoration).
- Render: `formatDuration(asset.duration_ms)` (already in `lib/utils.ts`),
  `asset.codec` for Format, `formatDate(asset.created_at)` for Date, and a
  Play button per row.
- **Play UX**: open a small `<Dialog>` (shadcn) holding `<audio controls autoPlay src={url} />`,
  where `url` comes from `getPlaybackUrl(asset.key)` in `lib/api-client.ts`.
  Reuse the loading/error toast pattern from `components/library/audio-asset-card.tsx`
  for consistency.
- "View all" link should point to `/library` (currently points to `/files`).
- Empty state copy stays usable when the kit is empty.

### 2. Header dual CTA + Empty state

**File**: `apps/web/src/app/page.tsx`

- Header: keep "Upload audio" as primary; add secondary `Button` (variant="outline")
  linking to `/library` labeled "Browse library →" (use `ArrowRight` icon).
- Empty state: read `useFileStats()` data at the top of the page. If
  `stats?.total_audio_assets === 0` (and not loading/erroring), render a single
  hero card ("No audio yet — upload your first track") with the upload CTA, instead
  of the StatsCards + UploadChart + RecentUploadsTable grid. Keep the existing
  layout when there's any audio.
- Don't double-fetch — `StatsCards` already calls `useFileStats`; TanStack Query
  dedupes on the same key, so calling it again in `page.tsx` is free.

### 3. Format breakdown card

**New file**: `apps/web/src/components/dashboard/format-breakdown.tsx`

- Consume `stats.formats: Record<string, number>` (already on `useFileStats()`).
- Render compactly. Recommended: small `Card` with horizontal chips
  (`wav 5 · mp3 12 · flac 1`), sorted by count desc. Keep it under one tile high.
- Hide entirely when `Object.keys(formats).length === 0` (don't render an empty card).
- Slot into `page.tsx` between StatsCards and the chart/table grid, OR replace
  the right side of the lg grid swapping the table to full-width. Pick whichever
  reads cleaner once mounted; ask the user if unsure.

### 4. Upload chart: "Minutes added" toggle

**File**: `apps/web/src/components/dashboard/upload-chart.tsx`

- Add a small segmented control in the `CardAction` slot (or below the title)
  with options "Uploads" / "Minutes". Local `useState<"uploads" | "minutes">`.
- When "Minutes", the bars render `Math.round(d.duration_ms / 60000)` with the
  Y axis still allowDecimals=false. Update `chartConfig` label + the "Total"
  number in the header to match.
- `DailyUploadCount` already carries `duration_ms` (backend done) — no API change.

### 5. Tests + docs + lint cleanup

#### Tests

- `services/api/tests/test_audio_aggregates.py` (new): exercises
  `get_audio_aggregates` with stubbed `list_audio_objects` + `head_audio_objects_parallel`.
  Assert: real `total_duration_ms`, correct `formats` counts (including the
  `"other"` bucket for unknown extensions), graceful handling of objects with
  no stamped metadata.
- `services/api/tests/test_upload_conflict.py`: add a case asserting that an
  audio upload propagates `metadata={"duration-ms": "...", "sample-rate": "..."}`
  to `upload_file` (capture via the existing stub).
- Frontend: Playwright e2e (`pnpm test:e2e`) — at least smoke-check that the
  dashboard renders the new tile and that an empty-bucket state shows the hero.

#### Docs (per AGENTS.md §8)

- `docs/features/audio-metadata.md`: document the `x-amz-meta-*` stamping at
  upload time and the kebab-case key names.
- `docs/features/audio-library.md`: note that list responses now include
  metadata (HEAD fanout); update the "Total Duration: 0" caveat.
- `docs/app-workflows.md`: refresh the Dashboard section — audio-first table,
  Storage tile, format breakdown, minutes toggle, empty state.
- `ARCHITECTURE.md`: brief note that `repo/b2_audio.py` exists alongside
  `b2_client.py`.

#### Lint

- `pnpm lint` currently reports 9 pre-existing `eqeqeq` errors + 1 warning,
  none introduced by this work, in:
  - `apps/web/src/components/files/file-metadata-panel.tsx`
  - `apps/web/src/components/library/audio-asset-card.tsx` (unused
    `eslint-disable jsx-a11y/media-has-caption` directive at line 108)
- Fix these as part of the closing pass. Don't bypass with `--no-verify`.

#### Final commands (must all pass before handoff)

```bash
pnpm lint
pnpm lint:api
pnpm test:api
pnpm check:structure
# e2e is slower, run last:
pnpm test:e2e
```

## Gotchas

- **S3 metadata is ASCII-only.** `to_s3_metadata` already coerces to `str()`
  on numeric fields. If you extend it with new fields, never pass user-controlled
  strings without sanitization — non-ASCII causes the PUT to fail.
- **Externally-seeded files** (anything under `audio/` that didn't go through
  our upload pipeline) have no `x-amz-meta-*` block. `_metadata_from_head`
  returns all `None`s for those, and aggregates contribute `0` to duration but
  still count toward `total_audio_assets` and `formats`. Don't "fix" this by
  HEAD-then-decode on the fly; that's a footgun for buckets with thousands of
  legacy files.
- **HEAD fanout cap**: aggregates HEAD up to `max_keys=10_000` objects in
  parallel with 10 workers. For a starter kit that's fine; if a downstream
  sample needs to scale, the right move is a persisted manifest, not a bigger
  thread pool.
- **`get_upload_activity` is now audio-only.** Pre-existing callers expecting
  every file in the bucket to be counted will see lower numbers. This is
  intentional — the chart is part of the audio dashboard. If somebody needs a
  full-bucket activity feed, expose it under a different endpoint.
- **TanStack Query keys**: `qk.stats()` covers the stats endpoint and is
  invalidated on mutations via `qk.all`. New tiles consuming `stats.formats` /
  `stats.audio_size_human` don't need their own query key.
- **The plan in `docs/exec-plans/active/` is the source of truth.** Once
  finished, move this file to `docs/exec-plans/completed/` and rename to the
  completion date.
