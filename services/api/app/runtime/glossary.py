"""HTTP routes for the glossary surface."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.service.glossary import (
    GlossaryKeyError,
    GlossaryNotFound,
    delete_glossary,
    get_glossary,
    list_glossaries,
    upsert_glossary,
)
from app.types import Glossary, GlossaryTerm

logger = logging.getLogger(__name__)

router = APIRouter()


class GlossaryUpsertRequest(BaseModel):
    id: str = Field(..., min_length=3, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    source_language: str = Field(..., min_length=2, max_length=16)
    terms: list[GlossaryTerm] = Field(default_factory=list)


@router.get("/glossaries", response_model=list[Glossary])
async def list_glossaries_endpoint():
    return list_glossaries()


@router.get("/glossaries/{glossary_id}", response_model=Glossary)
async def get_glossary_endpoint(glossary_id: str):
    try:
        return get_glossary(glossary_id)
    except GlossaryKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    except GlossaryNotFound as e:
        raise HTTPException(status_code=404, detail=e.detail) from None


@router.post("/glossaries", response_model=Glossary)
async def upsert_glossary_endpoint(req: GlossaryUpsertRequest):
    try:
        return upsert_glossary(
            req.id,
            req.name,
            req.source_language,
            req.terms,
        )
    except GlossaryKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None


@router.delete("/glossaries/{glossary_id}")
async def delete_glossary_endpoint(glossary_id: str):
    try:
        delete_glossary(glossary_id)
    except GlossaryKeyError as e:
        raise HTTPException(status_code=400, detail=e.detail) from None
    logger.info("Glossary deleted: glossary_id=%s", glossary_id)
    return {"deleted": True, "id": glossary_id}
