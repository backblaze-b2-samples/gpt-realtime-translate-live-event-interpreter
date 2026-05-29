<!-- last_verified: 2026-05-28 -->
# AGENTS.md

This is the authoritative control surface for all coding agents on the
**GPT-Realtime-Translate Live Event Interpreter**. Read this first.

## 1. Repository Map

```
apps/web/                                  Next.js 16 frontend (App Router, Tailwind v4, shadcn/ui)
  src/app/events/                          /events — Events explorer grid (sample-specific)
  src/app/events/[id]/                     /events/[id] — single-event detail (playback, transcripts, captions, artifacts)
  src/app/live/                            /live — Speaker console (mic capture -> speaker WS)
  src/app/live/[id]/listen/                /live/[id]/listen — Attendee view (listen WS + audio playback)
  src/app/glossary/                        /glossary — Glossary management
  src/app/files/                           /files  — full-bucket explorer (non-negotiable keep)
  src/components/events/                   event-card, events-view, waveform
services/api/                              FastAPI backend (layered: types/config/repo/service/runtime)
  app/runtime/events.py                    /events CRUD + presign endpoints
  app/runtime/live.py                      WebSocket: speaker + listen
  app/runtime/glossary.py                  /glossaries CRUD
  app/service/events.py                    Event lifecycle (validate, list, get, create, cascade-delete)
  app/service/realtime_session.py          Drives one Realtime session per target language, fan-out to attendees
  app/service/transcripts.py               Chunk accumulation + VTT/SRT persistence
  app/service/glossary.py                  Glossary load/store
  app/service/audio_metadata.py            wave + mutagen extractor for post-event source audio
  app/repo/b2_client.py                    boto3 — generic file helpers
  app/repo/b2_events.py                    boto3 — events / glossaries prefix helpers
  app/repo/openai_realtime.py              websockets — the ONLY place OpenAI's realtime API is contacted
  app/types/events.py                      Event, EventArtifact, EventStatus, EventCreateRequest, Language
  app/types/transcript.py                  TranscriptChunk, CaptionCue, TranscriptFormat
  app/types/glossary.py                    Glossary, GlossaryTerm
packages/shared/                           Shared TypeScript types (Event, EventArtifact, Glossary, etc.)
docs/                                      System of record (features, workflows, security, reliability)
docs/exec-plans/                           Execution plans and tech debt tracker
infra/railway/                             Deployment config
```

## 2. Architectural Invariants

**Backend layering**: `types` -> `config` -> `repo` -> `service` -> `runtime`

- No backward imports across layers
- No `boto3` outside `repo/`
- **No `openai` outside `repo/openai_realtime.py`** (mirrors the boto3 rule)
- No business logic in route handlers (`runtime/`)
- WebSocket handlers in `runtime/live.py` must NOT import from `repo/` directly — drive Realtime via `service/realtime_session.py`
- All external APIs wrapped in `repo/` adapters
- All request/response data validated at boundary (Pydantic models)
- No shared mutable state across layers

**Frontend**: shadcn/ui components in `src/components/ui/` are generated — never modify them.

**Data fetching**: every API call flows through TanStack Query hooks in `apps/web/src/lib/queries.ts`. No bare `useEffect + fetch` patterns. New endpoints touch three files: `runtime/<router>.py`, `lib/api-client.ts`, `lib/queries.ts`.

**Event storage convention**: events archive to `events/<event-id>/...` with the fan-out layout:

```
events/<event-id>/event.json                 — manifest
events/<event-id>/source.<wav|ogg|opus>      — source audio
events/<event-id>/source-transcript.{txt,vtt}
events/<event-id>/<bcp47>/captions.{vtt,srt}
events/<event-id>/<bcp47>/transcript.txt
events/<event-id>/<bcp47>/audio.<wav|opus>   — optional, per-language opt-in

glossaries/<glossary-id>.json
```

`<event-id>` is validated against `^[A-Za-z0-9_-]{6,64}$` at the API boundary with explicit `..` / `//` rejection (mirrors `service.events.EVENT_ID_RE`). Language codes are BCP-47-flavored — see `service.events.LANG_RE`.

**B2 surface**: S3-only. No `b2-native` calls anywhere. Every `boto3.client("s3", …)` instantiation MUST pass `Config(user_agent_extra="b2ai-gpt-realtime-translate-live-event-interpreter")`. No hardcoded region strings in source (use `B2_REGION` from `.env`).

**OpenAI surface**: only `repo/openai_realtime.py` contacts OpenAI's realtime API; everything else drives translation through `OpenAIRealtimeSession`. The adapter speaks the `gpt-realtime-translate` *Translations* protocol over `websockets` (the dedicated `/v1/realtime/translations` endpoint has no typed `openai`-SDK helper), opening **one session per target language**. `test_openai_only_in_repo` still enforces that no `openai` import leaks elsewhere. See [docs/features/realtime-translation.md](docs/features/realtime-translation.md).

## 3. Quality Expectations

- **DRY** — do not duplicate logic, types, or constants. Extract shared code only when used in 2+ places.
- Structured JSON logging only — no `print()` statements
- No raw SDK calls outside `repo/` layer
- Files stay under 300 lines
- Tests added or updated for every behavior change
- Docs updated in same PR as code changes
- Lint clean before merge
- Prefer boring, composable libraries over clever abstractions
- No implicit type assumptions — use typed models

## 4. Mechanical Enforcement

| Rule | Enforced by |
|------|-------------|
| No backward imports | `tests/test_structure.py::test_no_backward_imports` |
| No boto3 outside repo/ | `tests/test_structure.py::test_boto3_only_in_repo` |
| No openai outside repo/openai_realtime.py | `tests/test_structure.py::test_openai_only_in_repo` |
| WebSocket handlers don't import repo/ | `tests/test_structure.py::test_no_websocket_business_logic` |
| File size < 300 lines | `tests/test_structure.py::test_file_size_limits` |
| All layers exist | `tests/test_structure.py::test_all_layers_exist` |
| No bare print() | `ruff` rule T20 |
| Import ordering | `ruff` rule I001 |
| Frontend strict equality | `eslint` rule eqeqeq |
| No unused vars | `eslint` + `ruff` rules |

## 5. Commands

```bash
# Run
pnpm dev               # start both frontend and backend
pnpm dev:web           # frontend only
pnpm dev:api           # backend only

# Test & Lint
pnpm lint              # frontend lint (eslint)
pnpm build             # frontend type check + build
pnpm lint:api          # backend lint (ruff)
pnpm test:api          # backend tests (pytest)
pnpm check:structure   # structural boundary tests (incl. openai containment)
pnpm test:e2e          # Playwright e2e tests
```

## 6. Agent Workflow

1. Read this file first.
2. Review [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes.
3. For non-trivial changes, create a plan in `docs/exec-plans/active/`.
4. Implement the smallest coherent change.
5. Run: `pnpm lint && pnpm lint:api && pnpm test:api && pnpm check:structure`
6. Update docs in the same PR (see §8).
7. Move completed plans to `docs/exec-plans/completed/`.
8. Only change files relevant to the task. No drive-by improvements.

## 7. Frontend Conventions

See [docs/dev-workflows.md](docs/dev-workflows.md) for full details.

## 8. Doc Update Mapping

| Change Type | Update Location |
|-------------|-----------------|
| Feature logic, inputs, outputs, tests | `docs/features/<feature>.md` |
| User journeys | `docs/app-workflows.md` |
| System layout, deployments | `ARCHITECTURE.md` |
| Dev or testing process | `docs/dev-workflows.md` |
| Setup or scope changes | `README.md` |
| Security changes | `docs/SECURITY.md` |
| Reliability changes | `docs/RELIABILITY.md` |
| Active work plans | `docs/exec-plans/active/` |
| Known tech debt | `docs/exec-plans/tech-debt-tracker.md` |

If documentation and implementation conflict, update docs in the same PR. Documentation rot destroys agent reliability.

## 9. Doc Map

| Topic | Location |
|-------|----------|
| System layout, data flows, boundaries | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Feature docs | [docs/features/](docs/features/) |
| User journeys | [docs/app-workflows.md](docs/app-workflows.md) |
| Engineering workflows and testing | [docs/dev-workflows.md](docs/dev-workflows.md) |
| Security principles | [docs/SECURITY.md](docs/SECURITY.md) |
| Reliability expectations | [docs/RELIABILITY.md](docs/RELIABILITY.md) |
| Execution plans | [docs/exec-plans/](docs/exec-plans/) |
| Tech debt | [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) |

## 10. When Unsure

- Prefer boring, stable libraries (stdlib `wave`, `mutagen` — no ffmpeg)
- Prefer small PRs over large changes
- Add tests with every change
- Never bypass lint rules without explicit instruction
- Ask before making destructive or irreversible changes
