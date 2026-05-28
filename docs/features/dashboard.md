<!-- last_verified: 2026-05-28 -->
# Feature: Dashboard

## Purpose

Event-aware overview of B2 storage activity for the live-interpretation app. Surfaces the metrics that matter for a "fan-out, archive everything" workload: total events, total minutes interpreted, live now, peak concurrent attendees, plus a 7-day event-activity chart and a recent-events table.

## Used By

- UI: `/` page (dashboard home)
- API: `GET /files/stats`, `GET /events`, `GET /files/stats/activity`

## Stats tiles

1. **Events** — count of `events/<id>/` prefixes in the bucket (`EventStats.total_events`).
2. **Interpretation Minutes** — sum of `duration_ms` across every event manifest, rendered with `formatDuration`.
3. **Live Now** — count of manifests whose `status === "live"`.
4. **Peak Attendees** — max `attendee_peak` across every manifest.

## Activity chart

`GET /files/stats/activity?days=7` returns one `DailyEventCount` per day in the window:

```json
{ "date": "2026-05-28", "events": 3, "duration_ms": 5400000 }
```

The chart renders the `events` field by day. Today's bucket is seeded from `EventStats.events_today`; richer attribution (per-day historical counts) lands in the follow-up exec plan (see `docs/exec-plans/tech-debt-tracker.md`).

## Recent events table

`GET /events?limit=10` populates the table. Columns: title (linked to detail), status badge, source → targets, duration, created-at.

## Edge cases

- **Empty bucket** — the dashboard renders a single hero EmptyState prompting the first live event. StatsCards / chart / table stay off-screen until the bucket is populated.
- **API unreachable** — every component renders its own inline ErrorState with a Retry button.
- **Mixed orphan + manifest events** — orphan prefixes contribute to `total_events` but not to `total_duration_ms` / `attendee_peak` (since those come from the manifest).

## Tests

- The Dashboard's empty-state and stat-tile rendering inherits the structural correctness of the underlying `useFileStats` query. Backend coverage lives in `tests/test_events.py`.

## Related

- [Event Archive](event-archive.md)
- [Bucket Explorer](file-browser.md)
