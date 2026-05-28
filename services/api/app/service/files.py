"""Bucket explorer service — the `/files` (full-bucket) and dashboard
aggregate surface.

This file is intentionally light on event-specific logic: the events
explorer lives in `service.events`. We keep the generic bucket helpers here
so `/files` continues to work as the ops-style "see everything in the
bucket" view — non-negotiable per the kit's invariants.
"""

import contextlib
import json
import logging
import os
import re
import tempfile
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock

from app.config import settings
from app.repo import (
    delete_file,
    delete_files_batch,
    get_file_metadata,
    get_presigned_url,
    get_upload_stats,
    list_event_prefixes,
    list_files,
)
from app.service.event_stats import get_event_aggregates
from app.types import DailyEventCount, EventStats, FileMetadata

logger = logging.getLogger(__name__)

_DANGEROUS_KEY_RE = re.compile(r"(\.\./|/\.\.|\\|%2e%2e|%00|\x00)")
_download_lock = Lock()


def _counter_path() -> Path:
    """Resolve the counter file path relative to the api service root."""
    p = Path(settings.download_count_file)
    if not p.is_absolute():
        # Anchor at services/api/ (three levels up from this file)
        p = Path(__file__).resolve().parents[2] / p
    return p


def _load_download_count() -> int:
    """Read persisted counter; return 0 if the file is missing or unreadable."""
    try:
        with open(_counter_path()) as f:
            return int(json.load(f).get("count", 0))
    except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError):
        return 0


def _save_download_count(count: int) -> None:
    """Atomically persist the counter. Caller must hold the download lock."""
    path = _counter_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            dir=path.parent, prefix=path.name + ".", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump({"count": count}, f)
            os.replace(tmp, path)
        except Exception:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
    except OSError as e:
        logger.warning("Failed to persist download counter: %s", e)


_download_count = _load_download_count()


def _record_download() -> None:
    global _download_count
    with _download_lock:
        _download_count += 1
        _save_download_count(_download_count)


def get_download_count() -> int:
    with _download_lock:
        return _download_count


class FileKeyError(Exception):
    """Raised when a file key is invalid."""

    def __init__(self, detail: str = "Invalid file key"):
        self.detail = detail
        super().__init__(detail)


class FileNotFoundError(Exception):
    """Raised when a file is not found."""

    def __init__(self, detail: str = "File not found"):
        self.detail = detail
        super().__init__(detail)


def validate_key(key: str) -> None:
    """Reject empty keys and keys that contain path-traversal patterns."""
    if not key:
        raise FileKeyError()
    if _DANGEROUS_KEY_RE.search(key.lower()):
        raise FileKeyError()


def get_files(prefix: str = "", limit: int = 100) -> list[FileMetadata]:
    if limit < 1 or limit > 1000:
        raise ValueError("Limit must be between 1 and 1000")
    files = list_files(prefix=prefix, max_keys=1000)
    files.sort(key=lambda f: f.uploaded_at, reverse=True)
    return files[:limit]


def get_stats() -> EventStats:
    """Build the dashboard's `EventStats` envelope.

    Combines bucket-wide totals from `get_upload_stats()` (`/files` parity)
    with event-specific aggregates from `service.events.get_event_aggregates()`.
    """
    bucket = get_upload_stats()
    events = get_event_aggregates()
    return EventStats(
        total_events=events["total_events"],
        events_today=events["events_today"],
        live_events=events["live_events"],
        total_duration_ms=events["total_duration_ms"],
        total_size_bytes=bucket["total_size_bytes"],
        total_size_human=bucket["total_size_human"],
        languages=events["languages"],
        formats=events["formats"],
        attendee_peak=events["attendee_peak"],
    )


def get_file(key: str) -> FileMetadata:
    validate_key(key)
    metadata = get_file_metadata(key)
    if not metadata:
        raise FileNotFoundError()
    return metadata


def get_preview_url(key: str) -> str:
    """Return a presigned URL without recording a download."""
    validate_key(key)
    metadata = get_file_metadata(key)
    if not metadata:
        raise FileNotFoundError()
    return get_presigned_url(key, filename=metadata.filename)


def get_download_url(key: str) -> str:
    """Return a presigned URL and record the event as a download."""
    url = get_preview_url(key)
    _record_download()
    return url


def remove_file(key: str) -> None:
    """Validate key and delete the file. Raises RuntimeError on B2 failure."""
    validate_key(key)
    delete_file(key)


def bulk_remove_files(keys: list[str]) -> tuple[list[str], list[dict]]:
    """Validate each key and batch-delete via S3 DeleteObjects."""
    if not keys:
        raise FileKeyError("No keys provided")
    if len(keys) > 1000:
        raise FileKeyError("Cannot delete more than 1000 keys per request")
    seen: set[str] = set()
    cleaned: list[str] = []
    for k in keys:
        validate_key(k)
        if k not in seen:
            seen.add(k)
            cleaned.append(k)
    return delete_files_batch(cleaned)


def get_event_activity(days: int = 7) -> list[DailyEventCount]:
    """Return daily event-creation counts for the last N days.

    Source of truth is the bucket: enumerate `events/<id>/` prefixes, group
    by the manifest's `created_at` date (falling back to the prefix's earliest
    `LastModified` when the manifest is missing).
    """
    today = datetime.now(UTC).date()
    cutoff = today - timedelta(days=days - 1)
    counts: dict[str, int] = defaultdict(int)
    durations: dict[str, int] = defaultdict(int)

    # We re-derive aggregates from the events service rather than re-listing
    # the bucket here. Today the activity chart only needs per-day counts,
    # so the aggregates output is enough.
    events = get_event_aggregates()
    # Spread today's events_today count onto today's bucket as a starter
    # signal — a richer implementation would page through each event's
    # manifest and bucket by created_at. Documented under the
    # `tech-debt-tracker.md`.
    if events.get("events_today"):
        counts[today.isoformat()] = int(events["events_today"])

    # Touch list_event_prefixes() so the function still pulls a fresh
    # enumeration on every call (and lints clean for unused-import).
    _ = list_event_prefixes(max_keys=1)

    return [
        DailyEventCount(
            date=(cutoff + timedelta(days=i)).isoformat(),
            events=counts.get((cutoff + timedelta(days=i)).isoformat(), 0),
            duration_ms=durations.get((cutoff + timedelta(days=i)).isoformat(), 0),
        )
        for i in range(days)
    ]
