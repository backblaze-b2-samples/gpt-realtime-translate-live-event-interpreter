<!-- last_verified: 2026-05-28 -->
# Glossary

## Purpose

Reusable JSON glossaries that enforce domain-specific term translations during a live event. Attach one at event creation; the Realtime session uses it as a prompt-side constraint.

## Storage

```
glossaries/<glossary-id>.json
```

One JSON document per glossary. `<glossary-id>` is validated against `^[A-Za-z0-9_-]{3,64}$` at the API boundary.

## Document shape

```json
{
  "id": "engineering-terms",
  "name": "Engineering vocabulary",
  "source_language": "en",
  "terms": [
    {
      "term": "kernel",
      "translations": { "es": "núcleo", "fr": "noyau" },
      "note": "Linux kernel, not the math kind."
    }
  ],
  "created_at": "2026-05-28T10:00:00Z",
  "updated_at": "2026-05-28T10:00:00Z"
}
```

## Endpoints

- `GET /glossaries` — list every doc under `glossaries/`
- `GET /glossaries/{id}` — fetch one
- `POST /glossaries` — upsert (creates or replaces; preserves the original `created_at` when updating)
- `DELETE /glossaries/{id}` — remove

## Attach-at-create flow

`POST /events` accepts a `glossary_id` field. The backend records it on the event manifest. When the Realtime session opens, `service.realtime_session` fetches the doc and passes the term list into the Realtime prompt.

## Prompt-injection safety

- Glossary `term` and `translations` values are *quoted* and *escaped* before being interpolated into the prompt — they're treated as data, not instructions.
- The `note` field is ignored when building the prompt; it exists for human operators only.
- Glossary docs go to B2 as `application/json`, so a malicious upload can't be served as `text/html`.

## Tests

- The structural and routing tests cover the layering invariants. Term-substitution correctness lands with the Realtime wiring.

## Related

- [Live Interpretation](live-interpretation.md)
- [Realtime Translation](realtime-translation.md)
- [Event Archive](event-archive.md)
