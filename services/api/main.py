import json
import logging
import sys
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

# Single source of truth: repo-root .env. Anchored to this file's path so it
# resolves correctly regardless of where uvicorn is invoked from (local
# `cd services/api && uvicorn`, Docker WORKDIR, etc.).
REPO_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(REPO_ROOT_ENV)

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.middleware.base import BaseHTTPMiddleware  # noqa: E402

from app.config import B2_REQUIRED_ENV, setting_attr_for_env, settings  # noqa: E402
from app.runtime import config as runtime_config  # noqa: E402
from app.runtime import (  # noqa: E402
    events,
    files,
    glossary,
    health,
    live,
    metrics,
)

# --- Startup validation ---
# Required B2 settings are declared with empty-string defaults so that
# `Settings()` instantiation (and therefore `from main import app`) never
# raises during test collection. We instead fail fast at server startup
# with a human-readable message.
REQUIRED_B2_SETTINGS = tuple(
    (setting_attr_for_env(env_name), env_name) for env_name in B2_REQUIRED_ENV
)

# Exact placeholder strings shipped in .env.example. If a user copied
# the example and didn't edit it, Settings will pass the "non-empty"
# check above but every B2 call will still 403. Catch that here.
PLACEHOLDER_VALUES = frozenset({
    "your_b2_region",
    "your_application_key_id",
    "your_application_key",
    "your-bucket-name",
    "your_openai_api_key",
})


@asynccontextmanager
async def lifespan(_app: "FastAPI"):
    legacy_used, legacy_stale = settings.b2_legacy_env_usage()
    if legacy_used:
        logger.warning(
            "Legacy B2 configuration variables are being used; add the "
            "standard B2 variables before removing legacy aliases.",
            extra={"config_keys": list(legacy_used)},
        )
    if legacy_stale:
        logger.warning(
            "Legacy B2 configuration variables are present but ignored "
            "because standard variables are set or no longer needed.",
            extra={"config_keys": list(legacy_stale)},
        )

    missing = [
        env_name
        for attr, env_name in REQUIRED_B2_SETTINGS
        if not getattr(settings, attr)
    ]
    if missing:
        raise RuntimeError(
            "Missing required B2 configuration: "
            + ", ".join(missing)
            + f". Add them to {REPO_ROOT_ENV} (see .env.example) and restart."
        )

    placeholders = [
        env_name
        for attr, env_name in REQUIRED_B2_SETTINGS
        if getattr(settings, attr) in PLACEHOLDER_VALUES
    ]
    if placeholders:
        raise RuntimeError(
            "B2 configuration still has placeholder values: "
            + ", ".join(placeholders)
            + f". Edit {REPO_ROOT_ENV} with your real B2 credentials and restart."
        )

    # OpenAI is required for the live-interpretation feature. We warn rather
    # than hard-fail so the rest of the app (events explorer, /files, etc.)
    # remains usable while the user is still gathering credentials.
    if (
        not settings.openai_api_key
        or settings.openai_api_key in PLACEHOLDER_VALUES
    ):
        logger.warning(
            "OPENAI_API_KEY is missing or placeholder — live interpretation "
            "endpoints will return scaffold-stub errors until the key is set."
        )
    yield

# --- Structured JSON logging ---

class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        if hasattr(record, "event_id"):
            log_entry["event_id"] = record.event_id
        if hasattr(record, "target_lang"):
            log_entry["target_lang"] = record.target_lang
        if hasattr(record, "config_keys"):
            log_entry["config_keys"] = record.config_keys
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = str(record.exc_info[1])
        return json.dumps(log_entry)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JSONFormatter())
logging.root.handlers = [handler]
logging.root.setLevel(logging.INFO)
# Quiet noisy libraries
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

logger = logging.getLogger("api")


# --- App setup ---

app = FastAPI(
    title="GPT-Realtime-Translate Live Event Interpreter API",
    description=(
        "Live event interpretation, transcripts, captions, and glossaries "
        "backed by Backblaze B2 and OpenAI Realtime."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Optional regex (empty by default). When set, any origin matching
    # the pattern is allowed in addition to the explicit allowlist.
    allow_origin_regex=settings.api_cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Request ID + timing middleware
app.add_middleware(BaseHTTPMiddleware, dispatch=metrics.timing_middleware)

app.include_router(health.router, tags=["health"])
app.include_router(runtime_config.router, tags=["config"])
app.include_router(events.router, tags=["events"])
app.include_router(live.router, tags=["live"])
app.include_router(glossary.router, tags=["glossary"])
app.include_router(files.router, tags=["files"])
app.include_router(metrics.router, tags=["metrics"])
