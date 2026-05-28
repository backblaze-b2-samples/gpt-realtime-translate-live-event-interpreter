"""Glossary lifecycle service.

Glossaries are JSON docs persisted at `glossaries/<id>.json`. They're
optional and reusable across events — the speaker page lets you attach one
at event creation so the Realtime session enforces domain-specific term
substitution.

Scaffold status:
    The list / get / create / delete service methods are wired against the
    real B2 repo. The "inject into Realtime prompt" path lives in
    `service.realtime_session` and is a stub until the OpenAI Realtime
    integration lands.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime

from app.repo import (
    GLOSSARIES_PREFIX,
    delete_event_object,
    get_event_object_bytes,
    list_glossary_objects,
    put_event_object,
)
from app.types import Glossary, GlossaryTerm

logger = logging.getLogger(__name__)

GLOSSARY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")


class GlossaryKeyError(Exception):
    def __init__(self, detail: str = "Invalid glossary id"):
        self.detail = detail
        super().__init__(detail)


class GlossaryNotFound(Exception):
    def __init__(self, detail: str = "Glossary not found"):
        self.detail = detail
        super().__init__(detail)


def validate_glossary_id(glossary_id: str) -> None:
    if (
        not glossary_id
        or ".." in glossary_id
        or "//" in glossary_id
        or not GLOSSARY_ID_RE.match(glossary_id)
    ):
        raise GlossaryKeyError()


def _key(glossary_id: str) -> str:
    return f"{GLOSSARIES_PREFIX}{glossary_id}.json"


def list_glossaries() -> list[Glossary]:
    objects = list_glossary_objects()
    out: list[Glossary] = []
    for obj in objects:
        key = obj["Key"]
        if not key.endswith(".json"):
            continue
        body = get_event_object_bytes(key)
        if body is None:
            continue
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        try:
            out.append(Glossary(**data))
        except (TypeError, ValueError) as e:
            logger.warning("Skipping malformed glossary %s: %s", key, e)
    out.sort(key=lambda g: g.updated_at, reverse=True)
    return out


def get_glossary(glossary_id: str) -> Glossary:
    validate_glossary_id(glossary_id)
    body = get_event_object_bytes(_key(glossary_id))
    if body is None:
        raise GlossaryNotFound()
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise GlossaryNotFound(detail=f"Malformed glossary doc: {e}") from None
    return Glossary(**data)


def upsert_glossary(
    glossary_id: str,
    name: str,
    source_language: str,
    terms: list[GlossaryTerm],
) -> Glossary:
    validate_glossary_id(glossary_id)
    now = datetime.now(UTC)
    existing_created = now
    try:
        existing = get_glossary(glossary_id)
        existing_created = existing.created_at
    except GlossaryNotFound:
        pass
    doc = Glossary(
        id=glossary_id,
        name=name,
        source_language=source_language,
        terms=terms,
        created_at=existing_created,
        updated_at=now,
    )
    payload = doc.model_dump_json().encode("utf-8")
    put_event_object(_key(glossary_id), payload, "application/json")
    return doc


def delete_glossary(glossary_id: str) -> None:
    validate_glossary_id(glossary_id)
    delete_event_object(_key(glossary_id))
