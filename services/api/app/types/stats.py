from pydantic import BaseModel


class DailyEventCount(BaseModel):
    """One day's worth of event activity for the dashboard chart."""

    date: str
    events: int
    duration_ms: int = 0


class EventStats(BaseModel):
    """Dashboard metrics for the live-interpretation surface.

    Sourced from `ListObjectsV2` over the `events/` prefix + per-event
    `event.json` HEADs — no application database. `formats` tracks the
    extension distribution of archived source audio.
    """

    total_events: int = 0
    events_today: int = 0
    live_events: int = 0
    total_duration_ms: int = 0
    total_size_bytes: int = 0
    total_size_human: str = "0 B"
    languages: dict[str, int] = {}
    formats: dict[str, int] = {}
    attendee_peak: int = 0
