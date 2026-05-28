import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter()

# Thread-safe in-process metrics counters
_lock = Lock()
_request_count: dict[str, int] = defaultdict(int)
_request_duration_sum: dict[str, float] = defaultdict(float)
_event_started = 0
_event_ended = 0
_attendees_joined = 0
_realtime_chunks = 0


def record_request(method: str, path: str, status: int, duration: float) -> None:
    # Use | separator to avoid ambiguity with underscores in paths
    key = f"{method}|{path}|{status}"
    with _lock:
        _request_count[key] += 1
        _request_duration_sum[key] += duration


def record_event_started() -> None:
    global _event_started
    with _lock:
        _event_started += 1


def record_event_ended() -> None:
    global _event_ended
    with _lock:
        _event_ended += 1


def record_attendee_joined() -> None:
    global _attendees_joined
    with _lock:
        _attendees_joined += 1


def record_realtime_chunk() -> None:
    global _realtime_chunks
    with _lock:
        _realtime_chunks += 1


@router.get("/metrics")
async def metrics():
    lines = []
    lines.append("# HELP http_requests_total Total HTTP requests")
    lines.append("# TYPE http_requests_total counter")
    with _lock:
        for key, count in sorted(_request_count.items()):
            parts = key.split("|")
            method = parts[0] if len(parts) == 3 else "unknown"
            path = parts[1] if len(parts) == 3 else key
            status = parts[2] if len(parts) == 3 else "unknown"
            lines.append(
                f'http_requests_total{{method="{method}",path="{path}",status="{status}"}} {count}'
            )

        lines.append("# HELP http_request_duration_seconds Total request duration")
        lines.append("# TYPE http_request_duration_seconds counter")
        for key, duration in sorted(_request_duration_sum.items()):
            parts = key.split("|")
            method = parts[0] if len(parts) == 3 else "unknown"
            path = parts[1] if len(parts) == 3 else key
            status = parts[2] if len(parts) == 3 else "unknown"
            lines.append(
                f'http_request_duration_seconds{{method="{method}",path="{path}",status="{status}"}} {duration:.6f}'
            )

        lines.append("# HELP events_started_total Total live events started")
        lines.append("# TYPE events_started_total counter")
        lines.append(f"events_started_total {_event_started}")

        lines.append("# HELP events_ended_total Total live events ended")
        lines.append("# TYPE events_ended_total counter")
        lines.append(f"events_ended_total {_event_ended}")

        lines.append("# HELP attendees_joined_total Total attendee connections")
        lines.append("# TYPE attendees_joined_total counter")
        lines.append(f"attendees_joined_total {_attendees_joined}")

        lines.append("# HELP realtime_chunks_total Translated chunks broadcast")
        lines.append("# TYPE realtime_chunks_total counter")
        lines.append(f"realtime_chunks_total {_realtime_chunks}")

    return Response(content="\n".join(lines) + "\n", media_type="text/plain")


async def timing_middleware(request: Request, call_next):
    start = time.time()
    try:
        response = await call_next(request)
    except Exception:
        # Catch-all: log the error, return a safe 500 response
        logger.error(
            "Unhandled exception: %s %s",
            request.method,
            request.url.path,
            exc_info=True,
        )
        response = JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )
    duration = time.time() - start
    # Use the matched route template to avoid unbounded cardinality
    route = request.scope.get("route")
    path = route.path if route else request.url.path
    record_request(
        request.method,
        path,
        response.status_code,
        duration,
    )
    return response
