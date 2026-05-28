"""HTTP routes for the live-event surface.

All event-level business logic lives in `app.service.events`. This module is
the FastAPI entrypoint: argument validation, status-code translation, and
structured logging.
"""

import logging

from fastapi import APIRouter, HTTPException

from app.service.events import (
    EventKeyError,
    EventNotFound,
    create_event,
    delete_event,
    get_captions_url,
    get_event,
    get_source_audio_url,
    get_transcript_url,
    list_events,
)
from app.types import Event, EventCreateRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/events", response_model=list[Event])
async def list_events_endpoint(limit: int = 100):
    try:
        return list_events(limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/events", response_model=Event)
async def create_event_endpoint(req: EventCreateRequest):
    try:
        return create_event(req)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None


@router.get("/events/{event_id}", response_model=Event)
async def get_event_endpoint(event_id: str):
    try:
        return get_event(event_id)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    except EventNotFound as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.delete("/events/{event_id}")
async def delete_event_endpoint(event_id: str):
    try:
        deleted, errors = delete_event(event_id)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    logger.info(
        "Event deleted: event_id=%s deleted=%d errors=%d",
        event_id,
        len(deleted),
        len(errors),
    )
    return {"deleted": deleted, "errors": errors}


@router.get("/events/{event_id}/source-audio")
async def source_audio_endpoint(event_id: str):
    try:
        url = get_source_audio_url(event_id)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    except EventNotFound as e:
        raise HTTPException(status_code=404, detail=e.detail) from None
    return {"url": url, "expires_in": 600}


@router.get("/events/{event_id}/transcript")
async def transcript_endpoint(event_id: str, lang: str | None = None):
    try:
        url = get_transcript_url(event_id, lang=lang)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    return {"url": url, "expires_in": 600}


@router.get("/events/{event_id}/captions")
async def captions_endpoint(event_id: str, lang: str, fmt: str = "vtt"):
    try:
        url = get_captions_url(event_id, lang=lang, fmt=fmt)
    except EventKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    return {"url": url, "expires_in": 600}
