import json
import os
import re
from pathlib import Path

from dotenv import dotenv_values
from pydantic import AliasChoices, Field, PrivateAttr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Anchor the env file to the repo root so settings load identically no matter
# the process CWD. `dev:api` launches uvicorn from `services/api`, so a relative
# ".env" would resolve to a nonexistent `services/api/.env` and silently fall
# back to code defaults. parents[4] == repo root (config -> app -> api ->
# services -> root). Absent (e.g. in CI), pydantic just uses the defaults below.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_ENV_FILE = _REPO_ROOT / ".env"
_B2_ENV_CONTRACT_FILE = _REPO_ROOT / "config" / "b2-env-contract.json"
B2_REGION_RE = re.compile(
    r"^(?:us|eu|ap|ca|sa|af|me)-[a-z]+(?:-[a-z]+)*-\d{3}$"
)


def _load_b2_env_contract() -> dict:
    return json.loads(_B2_ENV_CONTRACT_FILE.read_text())


_B2_ENV_CONTRACT = _load_b2_env_contract()
B2_REQUIRED_ENV: tuple[str, ...] = tuple(_B2_ENV_CONTRACT["required"])
B2_OPTIONAL_ENV: tuple[str, ...] = tuple(_B2_ENV_CONTRACT["optional"])
B2_LEGACY_ALIASES: dict[str, str | None] = dict(
    _B2_ENV_CONTRACT["legacyAliases"]
)


def setting_attr_for_env(env_name: str) -> str:
    return env_name.lower()


def _normalize_env_files(env_file) -> tuple[Path, ...]:
    if env_file is None:
        return ()
    if isinstance(env_file, (str, os.PathLike)):
        return (Path(env_file),)
    return tuple(Path(path) for path in env_file if path)


def _configured_env_names(env_files: tuple[Path, ...]) -> set[str]:
    names: set[str] = set()
    for env_file in env_files:
        if env_file.exists():
            names.update(
                key
                for key, value in dotenv_values(env_file).items()
                if key and value
            )
    names.update(key for key, value in os.environ.items() if value)
    return names


class Settings(BaseSettings):
    _effective_env_files: tuple[Path, ...] = PrivateAttr(default=(_ENV_FILE,))

    b2_application_key_id: str = Field(
        "",
        validation_alias=AliasChoices(
            "B2_APPLICATION_KEY_ID", "B2_KEY_ID"
        ),
    )
    b2_region: str = Field("", validation_alias="B2_REGION")
    b2_application_key: str = Field(
        "", validation_alias="B2_APPLICATION_KEY"
    )
    b2_bucket_name: str = Field("", validation_alias="B2_BUCKET_NAME")
    b2_public_url_base: str = Field(
        "",
        validation_alias=AliasChoices(
            "B2_PUBLIC_URL_BASE", "B2_PUBLIC_URL"
        ),
    )

    # OpenAI Realtime — required to drive live interpretation. We tolerate empty
    # defaults so `Settings()` instantiation never raises during test collection;
    # `main.py::lifespan` fails fast at startup when the key is missing.
    openai_api_key: str = ""
    openai_realtime_model: str = "gpt-realtime-translate"

    # Live interpretation defaults (overridable per-event from the speaker console).
    default_source_language: str = "en"
    default_target_languages: str = "es,fr,de,ja"
    # Archive each language's translated audio to B2 by default. Set to False in
    # `.env` to keep only captions/transcripts and skip the per-language audio.
    persist_translated_audio: bool = True

    api_port: int = 8000
    # Explicit allowlist by default — covers Next on :3000 and the
    # fallback :3001 it picks if 3000 is busy. Production deploys should
    # override with the exact frontend origin.
    api_cors_origins: str = "http://localhost:3000,http://localhost:3001"
    # Optional dev-only escape hatch: a regex that matches additional
    # allowed origins. Empty by default — set this to e.g.
    # `^http://localhost:\d+$` to accept any localhost port without
    # listing each one. NEVER ship this to production.
    api_cors_origin_regex: str = ""

    # Source audio: cap any single archived source recording to keep an unbounded
    # event from filling B2. 500 MB is generous for typical conference talks.
    max_file_size: int = 500 * 1024 * 1024  # 500MB

    # Small durable counters (downloads, etc). Point at a persistent
    # volume in production if you care about surviving restarts.
    download_count_file: str = "data/download_count.json"

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        populate_by_name=True,
    )

    def __init__(self, **values):
        env_file = values.get("_env_file", _ENV_FILE)
        super().__init__(**values)
        self._effective_env_files = _normalize_env_files(env_file)

    @field_validator("b2_region")
    @classmethod
    def validate_b2_region(cls, value: str) -> str:
        if not value:
            return value
        if value != value.strip() or not B2_REGION_RE.fullmatch(value):
            raise ValueError(
                "B2_REGION must be a lowercase Backblaze region code "
                "ending in a three-digit cluster id"
            )
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",")]

    @property
    def b2_endpoint(self) -> str:
        if not self.b2_region:
            return ""
        return f"https://s3.{self.b2_region}.backblazeb2.com"

    def b2_legacy_env_usage(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        configured = _configured_env_names(self._effective_env_files)
        used: list[str] = []
        stale: list[str] = []
        for legacy_name, standard_name in B2_LEGACY_ALIASES.items():
            if legacy_name not in configured:
                continue
            if standard_name and standard_name not in configured:
                used.append(legacy_name)
            else:
                stale.append(legacy_name)
        return tuple(sorted(used)), tuple(sorted(stale))

    @property
    def default_target_language_list(self) -> list[str]:
        return [
            lang.strip().lower()
            for lang in self.default_target_languages.split(",")
            if lang.strip()
        ]


settings = Settings()
