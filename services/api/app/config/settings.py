from pathlib import Path

from pydantic_settings import BaseSettings

# Anchor the env file to the repo root so settings load identically no matter
# the process CWD. `dev:api` launches uvicorn from `services/api`, so a relative
# ".env" would resolve to a nonexistent `services/api/.env` and silently fall
# back to code defaults. parents[4] == repo root (config -> app -> api ->
# services -> root). Absent (e.g. in CI), pydantic just uses the defaults below.
_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    b2_application_key_id: str = ""
    b2_region: str = ""
    b2_application_key: str = ""
    b2_bucket_name: str = ""
    b2_public_url_base: str = ""

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

    model_config = {"env_file": str(_ENV_FILE), "env_file_encoding": "utf-8"}

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",")]

    @property
    def b2_endpoint(self) -> str:
        if not self.b2_region:
            return ""
        return f"https://s3.{self.b2_region}.backblazeb2.com"

    @property
    def default_target_language_list(self) -> list[str]:
        return [
            lang.strip().lower()
            for lang in self.default_target_languages.split(",")
            if lang.strip()
        ]


settings = Settings()
