# Scaffold Plan — `gpt-realtime-translate-live-event-interpreter`

**Source-kit override:** The user instructed us to use **`ai-audio-starter-kit`** as the template instead of the default `vibe-coding-starter-kit`. The fresh clone lives at `.claude/scratch/aask-dea55654-f9d9-4e99-90c2-3f585d4d9b56/` and is the sole source of truth for all keep/trim/add decisions below. The builder and reviewer subagents must ignore the sibling `../ai-audio-starter-kit` checkout entirely.

**Source issue:** `backblaze-labs/demand-side-ai#174`

---

## 1. Purpose

`gpt-realtime-translate-live-event-interpreter` is a real-time **live event interpreter**. A speaker talks into the browser; attendees pick a target language and receive translated audio + captions streamed back in real time using OpenAI's **GPT-Realtime-Translate**. Every event produces a rich, multi-artifact archive in B2: source audio, source transcript, per-language captions (VTT/SRT), per-language translated transcripts, and optionally the translated audio itself.

It is **distinct** from the existing video-dubbing sample card: this is *live* interpretation (low-latency, one-to-many broadcast), not upload-based dubbing, voice cloning, or lip-sync.

**Audience:** developers evaluating B2 for AI-audio workloads where a single source generates many derived artifacts per event — i.e., the canonical "fan-out, archive everything" pattern that maps cleanly to object storage.

**SEO / demand surface:** ranks for "GPT-Realtime-Translate", "live event interpreter", "real-time speech translation app".

## 2. Architecture delta from `ai-audio-starter-kit`

Source: `.claude/scratch/aask-dea55654-f9d9-4e99-90c2-3f585d4d9b56/`. The starter kit is the ceiling — strip what this app doesn't need; only *add* where the live-translation domain genuinely demands new surface.

### 2a. KEEP (as-is, or with content-only rebranding)

- **Backend layering** — `types → config → repo → service → runtime`; structural tests in `services/api/tests/test_structure.py`. Untouched.
- **`boto3` containment** — only in `repo/`. Add an *analogous* containment rule for the OpenAI SDK (see §2c).
- **B2 standards** — `boto3.client("s3", …)` with `Config(user_agent_extra="b2ai-gpt-realtime-translate-live-event-interpreter")`. S3-compatible API only. No `b2-native`.
- **`.env.example` schema** — keep the exact key names `B2_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, plus optional `B2_PUBLIC_URL`. (These are the keys the b2-sample-builder verifies.) **Add** OpenAI keys (see §2c).
- **Frontend data layer** — TanStack Query hooks in `apps/web/src/lib/queries.ts`; every API call flows through `lib/api-client.ts`. No bare `useEffect + fetch`.
- **shadcn/ui** — `apps/web/src/components/ui/` is generated; never modified.
- **`/files` route — full B2 bucket explorer** — **NON-NEGOTIABLE KEEP**. Stays as the ops-style "see everything in the bucket" view, last item in nav.
- **`/design` route** — design-system showcase. Stays; updated to feature the new `EventCard` primitive.
- **`/health` and `/metrics` endpoints** — connectivity + Prometheus counters.
- **Dashboard route (`/`)** — keep the layout primitives (stat cards, recent-activity table, daily chart). Content changes (see §2b "trim").
- **`mutagen` + stdlib `wave`** audio-metadata extractor (`services/api/app/service/audio_metadata.py`) — repurposed for source-audio post-event metadata. No ffmpeg.
- **Inline `<audio controls>` + waveform stub primitive** — re-used inside the single-event view to play the archived source audio.
- **Doctor preflight** (`scripts/doctor.mjs`) — extended to verify `OPENAI_API_KEY` is present and non-placeholder.
- **`pnpm dev` / `dev.sh`** orchestration, `pnpm test:e2e` (Playwright), `pnpm check:structure`.
- **`packages/shared`** workspace — keep, extend with `Event` / `EventArtifact` / `Caption` / `Language` types.
- **Railway deployment config** — keep `infra/railway/` shape; rename service identifiers per §6.
- **Top-level doc shapes** — `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `docs/SECURITY.md`, `docs/RELIABILITY.md`, `docs/app-workflows.md`, `docs/dev-workflows.md`, `docs/design-system.md`, `docs/exec-plans/{active,completed}/`. Content rewritten (see §5).
- **Structured JSON logging + request-id middleware** — keep wholesale; add new log fields for `event_id`, `target_lang` where applicable.

### 2b. TRIM (remove from starter)

- **`/upload` route** (`apps/web/src/app/upload/`) — **REMOVE entirely.** This is live interpretation, not upload-based dubbing. The user note explicitly distinguishes the sample from upload-based dubbing workflows.
- **Backend upload surface** — remove `services/api/app/runtime/upload.py`, `service/upload.py`, `types/upload.py`. The `service/audio_metadata.py` extractor stays (used by the realtime pipeline when finalizing source recordings).
- **`/library` route** (`apps/web/src/app/library/`) — **REPLACE** with `/events`. The `/library` page exposes an audio-prefix grid; for this sample the equivalent sample-specific view is the **Events explorer** scoped to the `events/` prefix. (This satisfies the non-negotiable "sample-specific asset explorer" rule.)
- **`audio/<YYYY>/<MM>/<safe-filename>--<uuid>.<ext>` storage convention** — REPLACED by an event-keyed layout (see §3).
- **`AudioAssetCard`** — RENAMED to `EventCard`; content adapted (status badge, language chips, duration, attendee-peak count).
- **`AudioAsset` type** — REPLACED by `Event` + `EventArtifact`.
- **Dashboard "recent uploads" / "total audio duration" tiles** — REPLACED with "recent events", "total interpretation minutes", "active languages", "peak concurrent attendees".
- **`docs/features/file-upload.md`** — DELETED.
- **`docs/features/audio-library.md`** — DELETED (replaced by `event-archive.md`).
- **`b2_audio.py` audio-prefix repo helpers** — REPLACED by `b2_events.py` events-prefix helpers (same shape: list-by-prefix, parallel HEAD, validated key regex).
- **`tmp/audio-samples/`** seed directory — REMOVE; not relevant (sample audio is generated live, not pre-seeded).
- **`B2_PUBLIC_URL` direct-rendering hint in `.env.example`** — **KEEP**, but its scope narrows: applies to source audio + translated audio. No change to behavior.

### 2c. ADD (new for this sample)

**Routes (frontend):**

- **`/events`** — sample-specific Events explorer (Library equivalent). Grid of `EventCard`s with status (live / ended), source language, target-language chips, duration, attendee peak.
- **`/events/[id]`** — single-event detail view: audio player for source recording, side-by-side source + per-language transcripts, VTT/SRT downloads, optional translated-audio download per language.
- **`/live`** — Speaker console. Form to choose source language + target languages + per-language "persist translated audio?" toggle (default off) + optional glossary attach. "Go Live" button starts the WebSocket session. Live captions preview + attendee count.
- **`/live/[id]/listen`** — Attendee view. Pick target language; receive translated audio (inline `<audio>` MediaSource) + live captions overlay.
- **`/glossary`** — Glossary management: create/edit glossary docs (term + locale-specific replacements) stored as JSON in B2; attach to events.

**Backend routes & layers (FastAPI, layered per §2a):**

- **`runtime/events.py`** — `POST /events`, `GET /events`, `GET /events/{id}`, `DELETE /events/{id}`; presign endpoints `GET /events/{id}/source-audio`, `GET /events/{id}/transcript`, `GET /events/{id}/captions` (each takes optional `?lang=`).
- **`runtime/live.py`** — WebSocket endpoints `WS /events/{id}/speaker` and `WS /events/{id}/listen?lang=<bcp47>`.
- **`runtime/glossary.py`** — `GET/POST/DELETE /glossaries`, `GET /glossaries/{id}`.
- **`service/events.py`** — event lifecycle: create, list, get, delete (cascades B2 prefix delete).
- **`service/realtime_session.py`** — drives the OpenAI Realtime session per event; multiplexes translated streams to attendee fan-out queues.
- **`service/transcripts.py`** — accumulates transcript / caption chunks, emits VTT and SRT, persists on rotation + finalize.
- **`service/glossary.py`** — load/store glossary docs; provide prompt-injection-safe term substitution to the Realtime session.
- **`repo/openai_realtime.py`** — **THE ONLY** place the `openai` SDK is imported. Wraps Realtime connect/send/receive. Analogous to `boto3` containment.
- **`repo/b2_events.py`** — events-prefix B2 helpers (list, head parallel, delete-prefix), mirrors `b2_audio.py` shape.
- **`types/events.py`** — `Event`, `EventArtifact`, `EventStatus`, `Language` (BCP-47 wrapper), `EventCreateRequest`, `SpeakerSessionToken`.
- **`types/transcript.py`** — `TranscriptChunk`, `CaptionCue`, `TranscriptFormat`.
- **`types/glossary.py`** — `Glossary`, `GlossaryTerm`.

**Storage layout (B2, S3 API):**

```
events/<event-id>/event.json                       — event metadata (status, languages, timestamps)
events/<event-id>/source.<wav|ogg|opus>            — source audio (always archived)
events/<event-id>/source-transcript.txt
events/<event-id>/source-transcript.vtt
events/<event-id>/<bcp47>/transcript.txt
events/<event-id>/<bcp47>/captions.vtt
events/<event-id>/<bcp47>/captions.srt
events/<event-id>/<bcp47>/audio.<wav|opus>         — optional, per-language toggle (default off)

glossaries/<glossary-id>.json                       — reusable glossaries
```

Validation regex for `<event-id>`: `^[A-Za-z0-9_-]{6,64}$`. Language codes validated as BCP-47 (lowercase primary + optional region). Path traversal (`..`, `//`) rejected at API boundary, same pattern as `service/library.py::AUDIO_KEY_RE`.

**`.env.example` additions (new keys):**

```
# OpenAI Realtime (required)
OPENAI_API_KEY=your_openai_api_key
OPENAI_REALTIME_MODEL=gpt-realtime-translate

# Live interpretation defaults
DEFAULT_SOURCE_LANGUAGE=en
DEFAULT_TARGET_LANGUAGES=es,fr,de,ja
PERSIST_TRANSLATED_AUDIO=false
```

The five required `B2_*` keys remain unchanged (validation in `b2-sample-builder` step 6 will pass).

**Mechanical enforcement additions** (extend `tests/test_structure.py`):

- New test: `test_openai_only_in_repo` — `openai` import allowed only in `repo/openai_realtime.py`.
- New test: `test_no_websocket_business_logic` — WebSocket handlers in `runtime/live.py` may import service but not directly call `repo/`.

**E2E test stubs** (`apps/web/e2e/`):

- `events-list.spec.ts` — `/events` loads, renders empty state, then a seeded `event.json` shows up as a card.
- `live-speaker-smoke.spec.ts` — Speaker console renders mic permission UI; opening WebSocket without OPENAI_API_KEY surfaces inline ErrorState.
- `attendee-language-pick.spec.ts` — Attendee page renders language picker, falls back to source on unsupported language.

## 3. B2 surface

S3-compatible API operations only. No `b2-native`. User-agent: `b2ai-gpt-realtime-translate-live-event-interpreter`.

| Op | Where | Purpose |
|----|-------|---------|
| `PutObject` | `repo/b2_events.py` | persist source audio chunks, source transcript, per-lang captions / transcripts / translated audio, `event.json`, glossaries |
| `GetObject` | `repo/b2_events.py` | fetch `event.json`, transcripts, captions, glossary docs |
| `HeadObject` | `repo/b2_events.py::head_event_artifacts_parallel` | verify presence before presigning; populate event-detail view |
| `ListObjectsV2` | `repo/b2_events.py` | list events (`Prefix="events/"`, delimiter `/`); list per-event artifacts |
| `DeleteObject` / `DeleteObjects` | `repo/b2_events.py::delete_event_prefix` | cascade-delete all artifacts under an event prefix |
| Presigned `GetObject` | `repo/b2_events.py` | source-audio playback (inline, 10-min), transcript / caption download (attachment, 10-min) |

**No `b2-native`** is required. The `glossaries/` and `events/` prefixes are flat enough that S3 listing handles them comfortably. Lifecycle policies (e.g., auto-purge ended events after 30 days) are *not* configured at scaffold time — documented as a "you may want to add this" hook in `docs/RELIABILITY.md`.

## 4. Key features

1. **Live speaker → multi-language interpretation** — speaker streams browser microphone audio over WebSocket; backend brokers OpenAI Realtime session; translated audio + captions stream to all subscribed attendees per target language.
2. **Attendee multi-language listening** — `/live/[id]/listen?lang=<bcp47>` picks a language and streams translated audio (inline) + live captions overlay; gracefully degrades to source language on unsupported pick.
3. **Per-event archive in B2** — every event persists `event.json`, source audio, source transcript, and per-language captions + transcripts under `events/<event-id>/`. Translated audio is opt-in per language (default off).
4. **Events explorer + single-event detail** — `/events` grid (sample-specific Library); `/events/[id]` opens side-by-side transcripts, presigned downloads, source-audio playback with the existing waveform primitive.
5. **Glossary support** — `/glossary` manages reusable JSON glossaries; attach one at event creation so domain terminology is enforced by the Realtime session.
6. **Bucket explorer retained** — `/files` shows full bucket contents for ops-style browsing (NON-NEGOTIABLE KEEP).

## 5. Doc transforms

| File | Action | Notes |
|------|--------|-------|
| `README.md` | **REWRITE** | New title, hero, feature list, screenshot placeholders, env-var section now includes `OPENAI_API_KEY` and `OPENAI_REALTIME_MODEL`. |
| `ARCHITECTURE.md` | **REWRITE** | New component map (events, live, glossary); add OpenAI Realtime as external service; B2 layout = `events/<event-id>/...`; layering rules unchanged; user-agent updated. |
| `AGENTS.md` | **REWRITE** | New repo map; invariants section adds "openai SDK only in `repo/openai_realtime.py`"; commands unchanged. |
| `CLAUDE.md` | **KEEP shape** | Single-line pointer to AGENTS.md; only the last_verified date updates. |
| `docs/features/audio-library.md` | **DELETE → REPLACE** | Replaced by `event-archive.md`. |
| `docs/features/file-upload.md` | **DELETE** | No upload feature. |
| `docs/features/audio-metadata.md` | **REWRITE** | Scoped to source-audio metadata extracted post-event. |
| `docs/features/audio-playback.md` | **REWRITE** | Scoped to source-audio playback in event-detail view. |
| `docs/features/file-browser.md` | **KEEP (minor edit)** | References `/files` unchanged; rebrand UA/UTM. |
| `docs/features/dashboard.md` | **REWRITE** | Events-aware stats (recent events, total minutes interpreted, peak concurrent attendees). |
| `docs/features/event-archive.md` | **NEW** | `/events` explorer + `/events/[id]` detail view; B2 layout. |
| `docs/features/live-interpretation.md` | **NEW** | Speaker console + attendee view, WebSocket lifecycle, mic permission flow. |
| `docs/features/realtime-translation.md` | **NEW** | OpenAI Realtime integration, session lifecycle, reconnect strategy, language list. |
| `docs/features/transcripts-and-captions.md` | **NEW** | VTT/SRT generation, chunk persistence cadence, on-disconnect finalization. |
| `docs/features/glossary.md` | **NEW** | Glossary doc format, attach-at-create flow, prompt-injection safety. |
| `docs/app-workflows.md` | **REWRITE** | Three journeys: speaker (start event), attendee (join + listen), organizer (browse archive). |
| `docs/dev-workflows.md` | **MINOR EDIT** | Add WebSocket testing notes; otherwise unchanged. |
| `docs/SECURITY.md` | **AMEND** | New sections: event/speaker token gating, OpenAI API key handling, attendee-side audio-tag CSP. |
| `docs/RELIABILITY.md` | **AMEND** | New section: Realtime session resilience — reconnect, partial-transcript persistence on disconnect, lifecycle hook suggestion. |
| `docs/design-system.md` | **MINOR EDIT** | Reference `EventCard` (replaces `AudioAssetCard`); add language-chip primitive. |
| `docs/exec-plans/active/` | **KEEP empty** | Builder leaves untouched. |
| `docs/exec-plans/completed/` | **KEEP** | Skill Phase 5 moves this scaffold plan here as `initial-scaffold.md`. |

## 6. Rename table

Apply across every text file in the tree (skip `node_modules/`, `.venv/`, `dist/`, `build/`, `.next/`).

| Old | New |
|-----|-----|
| `ai-audio-starter-kit` (kebab) | `gpt-realtime-translate-live-event-interpreter` |
| `ai_audio_starter_kit` (snake) | `gpt_realtime_translate_live_event_interpreter` |
| `AI Audio Starter Kit` (title) | `GPT-Realtime-Translate Live Event Interpreter` |
| `@ai-audio-starter-kit/web` (pnpm workspace scope) | `@gpt-realtime-translate-live-event-interpreter/web` |
| `b2ai-ai-audio-starter-kit` (S3 user-agent extra + UTM `utm_content`) | `b2ai-gpt-realtime-translate-live-event-interpreter` |
| Docker image tag / Railway service slug `ai-audio-starter-kit` | `gpt-realtime-translate-live-event-interpreter` |
| GitHub workflow file slugs + `name:` headers | `gpt-realtime-translate-live-event-interpreter` |
| README repo URL `https://github.com/backblaze-b2-samples/ai-audio-starter-kit` | `https://github.com/backblaze-b2-samples/gpt-realtime-translate-live-event-interpreter` |
| Storage prefix `audio/` | `events/` (+ new `glossaries/`) |
| `AudioAsset` type (TS + Python) | `Event` + `EventArtifact` |
| `AudioAssetCard` React component | `EventCard` |
| route `/library` | `/events` |
| route `/upload` | **removed** |

**Notes for the builder:**

- The user-agent + UTM string is *long* (50 chars). Verify nothing has hard-coded length limits — the `boto3` `user_agent_extra` field has no documented cap, so this is safe. b2-doctor's audit checks for *presence* and *match-to-app-name*, not length.
- The pnpm scope `@gpt-realtime-translate-live-event-interpreter/web` is also long but valid (npm allows up to 214 chars total).
- The workspace package `name` in `apps/web/package.json` must change from `@ai-audio-starter-kit/web` → `@gpt-realtime-translate-live-event-interpreter/web` and the corresponding pnpm `--filter` invocations in root `package.json` scripts (`dev:web`, `build`, `typecheck`, `lint`, `test:e2e`).

---

## Resolved open questions (from the source issue)

The issue listed two open questions; this plan resolves both:

- **"One-to-many event broadcast, or two-person conversation mode first?"** → **One-to-many for v1.** Cleaner demo, clearer artifact story (one source, many derived per-language streams), maps better to B2's "fan-out, archive everything" pattern. Two-person conversation mode deferred to v2.
- **"Should v1 persist translated audio, or only captions/transcripts?"** → **Captions + transcripts always; translated audio per-language opt-in (default off).** Captions/transcripts are small and high-value for replay. Translated audio is large; making it per-language opt-in keeps the storage story honest and lets demos showcase the cost knob.

## Compliance pre-check against `b2-sample-builder` step 6

- `.env.example` includes the five required keys: `B2_ENDPOINT`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`. ✅
- Every `boto3.client("s3", …)` will set `user_agent_extra="b2ai-gpt-realtime-translate-live-event-interpreter"`. ✅
- Backblaze.com links carry `utm_content=b2ai-gpt-realtime-translate-live-event-interpreter`. ✅
- No `b2-native` usage. ✅
- No hardcoded region strings; `B2_REGION` always read from `.env`. ✅
- Non-negotiable: `/files` bucket explorer kept; sample-specific explorer added at `/events`. ✅

## Subagent override notes

Both subagents' definitions hard-code `vibe-coding-starter-kit` as the source repo and reference `../CLAUDE.md` as the parent. For this run, the orchestrator must explicitly tell each subagent:

1. **Source-tree path** is `.claude/scratch/aask-dea55654-f9d9-4e99-90c2-3f585d4d9b56/` (the `ai-audio-starter-kit` clone), **not** any `vibe-coding-starter-kit` checkout and **not** the sibling `../ai-audio-starter-kit` working copy.
2. **Initial-commit message** should read `Initial scaffold for gpt-realtime-translate-live-event-interpreter (from ai-audio-starter-kit)` — substitute the source kit name accordingly.
3. **Parent standards** — the sampleapps workstream has no `CLAUDE.md` at `../CLAUDE.md`. The authoritative parent standards live at `/Users/epavez/Documents/demand-side-ai/CLAUDE.md` (workstream parent) and in the b2-sample-builder agent's own step 6 checklist. Reviewer should treat the agent definition's checklist as the binding standard.
4. **Rename source string** — when the builder applies the rename table, it is rewriting from `ai-audio-starter-kit` → `gpt-realtime-translate-live-event-interpreter`, **not** from `vibe-coding-starter-kit`. The agent's default search strings must be substituted.
