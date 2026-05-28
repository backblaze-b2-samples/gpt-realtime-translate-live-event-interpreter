"""Pydantic models for the glossary surface.

Glossaries are JSON docs persisted at `glossaries/<id>.json` and optionally
attached to events to enforce domain-specific term substitution in the
Realtime translation prompt.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class GlossaryTerm(BaseModel):
    """A single glossary entry.

    `term` is the canonical source-language term. `translations` is a map
    of BCP-47 code -> preferred translation. Empty translations entries
    are allowed (terms that should be left untranslated).
    """

    term: str = Field(..., min_length=1, max_length=200)
    translations: dict[str, str] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=500)


class Glossary(BaseModel):
    """A reusable glossary document.

    The full set of terms ships inside `terms`. We store the doc as a single
    JSON object in B2 — not splitting per-term — so creating, editing, and
    attaching are all single-object operations against B2.
    """

    id: str = Field(..., min_length=3, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    source_language: str = Field(..., min_length=2, max_length=16)
    terms: list[GlossaryTerm] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
