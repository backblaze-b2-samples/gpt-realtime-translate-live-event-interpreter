"""Public configuration defaults consumed by the speaker console.

The `/live` page seeds its language picker + persist-audio toggle from this
endpoint so the values declared in `.env` are the single source of truth — no
duplication of defaults between backend `Settings` and frontend constants.

Only safe-to-expose fields are returned. Secrets (API keys, B2 credentials)
never leave the backend.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


class LiveDefaults(BaseModel):
    """Defaults for the speaker-console event-create form."""

    default_source_language: str
    default_target_languages: list[str]
    persist_translated_audio_default: bool


@router.get("/config/defaults", response_model=LiveDefaults)
async def get_defaults() -> LiveDefaults:
    return LiveDefaults(
        default_source_language=settings.default_source_language,
        default_target_languages=settings.default_target_language_list,
        persist_translated_audio_default=settings.persist_translated_audio,
    )
