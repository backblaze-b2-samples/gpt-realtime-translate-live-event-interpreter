from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config.settings import (
    B2_LEGACY_ALIASES,
    B2_OPTIONAL_ENV,
    B2_REQUIRED_ENV,
    Settings,
    setting_attr_for_env,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
ALL_B2_ENV = set(B2_REQUIRED_ENV) | set(B2_OPTIONAL_ENV) | set(
    B2_LEGACY_ALIASES
)


def clear_b2_env(monkeypatch):
    for name in ALL_B2_ENV:
        monkeypatch.delenv(name, raising=False)


def set_standard_b2_env(monkeypatch, region: str = "us-test-001"):
    monkeypatch.setenv("B2_APPLICATION_KEY_ID", "standard-key-id")
    monkeypatch.setenv("B2_APPLICATION_KEY", "standard-application-key")
    monkeypatch.setenv("B2_BUCKET_NAME", "standard-bucket")
    monkeypatch.setenv("B2_REGION", region)
    monkeypatch.setenv("B2_PUBLIC_URL_BASE", "https://cdn.example/bucket")


def test_b2_settings_use_standard_env_names(monkeypatch):
    clear_b2_env(monkeypatch)
    set_standard_b2_env(monkeypatch)

    settings = Settings(_env_file=None)

    assert settings.b2_application_key_id == "standard-key-id"
    assert settings.b2_application_key == "standard-application-key"
    assert settings.b2_bucket_name == "standard-bucket"
    assert settings.b2_region == "us-test-001"
    assert settings.b2_public_url_base == "https://cdn.example/bucket"
    assert settings.b2_endpoint == "https://s3.us-test-001.backblazeb2.com"


def test_b2_settings_accept_legacy_env_names(monkeypatch):
    clear_b2_env(monkeypatch)
    monkeypatch.setenv("B2_KEY_ID", "legacy-key-id")
    monkeypatch.setenv("B2_APPLICATION_KEY", "legacy-application-key")
    monkeypatch.setenv("B2_BUCKET_NAME", "legacy-bucket")
    monkeypatch.setenv("B2_REGION", "us-test-001")
    monkeypatch.setenv("B2_PUBLIC_URL", "https://legacy.example/bucket")

    settings = Settings(_env_file=None)

    assert settings.b2_application_key_id == "legacy-key-id"
    assert settings.b2_public_url_base == "https://legacy.example/bucket"
    assert settings.b2_legacy_env_usage() == (
        ("B2_KEY_ID", "B2_PUBLIC_URL"),
        (),
    )


def test_startup_placeholder_check_catches_legacy_key_id(monkeypatch):
    from main import PLACEHOLDER_VALUES, REQUIRED_B2_SETTINGS

    clear_b2_env(monkeypatch)
    monkeypatch.setenv("B2_KEY_ID", "your_key_id")
    monkeypatch.setenv("B2_APPLICATION_KEY", "standard-application-key")
    monkeypatch.setenv("B2_BUCKET_NAME", "standard-bucket")
    monkeypatch.setenv("B2_REGION", "us-test-001")
    settings = Settings(_env_file=None)

    placeholders = [
        env_name
        for attr, env_name in REQUIRED_B2_SETTINGS
        if getattr(settings, attr) in PLACEHOLDER_VALUES
    ]

    assert placeholders == ["B2_APPLICATION_KEY_ID"]


def test_b2_settings_prefer_standard_env_names(monkeypatch):
    clear_b2_env(monkeypatch)
    set_standard_b2_env(monkeypatch)
    monkeypatch.setenv("B2_KEY_ID", "legacy-key-id")
    monkeypatch.setenv("B2_PUBLIC_URL", "https://legacy.example/bucket")

    settings = Settings(_env_file=None)

    assert settings.b2_application_key_id == "standard-key-id"
    assert settings.b2_public_url_base == "https://cdn.example/bucket"
    assert settings.b2_legacy_env_usage() == (
        (),
        ("B2_KEY_ID", "B2_PUBLIC_URL"),
    )


def test_b2_settings_ignore_empty_standard_values_for_legacy_fallback(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "B2_APPLICATION_KEY_ID=",
                "B2_KEY_ID=legacy-key-id",
                "B2_APPLICATION_KEY=legacy-application-key",
                "B2_BUCKET_NAME=legacy-bucket",
                "B2_REGION=us-test-001",
                "B2_PUBLIC_URL_BASE=",
                "B2_PUBLIC_URL=https://legacy.example/bucket",
            ]
        )
    )

    settings = Settings(_env_file=env_file)

    assert settings.b2_application_key_id == "legacy-key-id"
    assert settings.b2_public_url_base == "https://legacy.example/bucket"
    assert settings.b2_legacy_env_usage() == (
        ("B2_KEY_ID", "B2_PUBLIC_URL"),
        (),
    )


def test_b2_settings_ignore_stale_legacy_dotenv_keys(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "B2_APPLICATION_KEY_ID=standard-key-id",
                "B2_APPLICATION_KEY=standard-application-key",
                "B2_BUCKET_NAME=standard-bucket",
                "B2_REGION=us-test-001",
                "B2_PUBLIC_URL_BASE=https://cdn.example/bucket",
                "B2_KEY_ID=legacy-key-id",
                "B2_ENDPOINT=https://legacy.example",
                "B2_PUBLIC_URL=https://legacy.example/bucket",
            ]
        )
    )

    settings = Settings(_env_file=env_file)

    assert settings.b2_application_key_id == "standard-key-id"
    assert settings.b2_endpoint == "https://s3.us-test-001.backblazeb2.com"
    assert settings.b2_public_url_base == "https://cdn.example/bucket"
    assert settings.b2_legacy_env_usage() == (
        (),
        ("B2_ENDPOINT", "B2_KEY_ID", "B2_PUBLIC_URL"),
    )


def test_b2_legacy_usage_skips_dotenv_when_disabled(monkeypatch):
    clear_b2_env(monkeypatch)

    settings = Settings(_env_file=None)

    assert settings.b2_legacy_env_usage() == ((), ())


@pytest.mark.parametrize(
    "region",
    [
        "attacker.example:443/collect",
        "https://attacker.example",
        "us" + "-west-004/../x",
        " us-test-001",
        "us-test-001 ",
        "user@us-test-001",
    ],
)
def test_b2_region_rejects_host_breaking_payloads(monkeypatch, region):
    clear_b2_env(monkeypatch)
    set_standard_b2_env(monkeypatch, region=region)

    with pytest.raises(ValidationError, match="B2_REGION"):
        Settings(_env_file=None)


def test_b2_env_contract_matches_settings_env_example_and_doctor(monkeypatch):
    clear_b2_env(monkeypatch)
    settings = Settings(_env_file=None)
    env_example = (REPO_ROOT / ".env.example").read_text()
    doctor = (REPO_ROOT / "scripts" / "doctor.mjs").read_text()

    for env_name in B2_REQUIRED_ENV + B2_OPTIONAL_ENV:
        assert hasattr(settings, setting_attr_for_env(env_name))
        assert f"{env_name}=" in env_example

    assert "config/b2-env-contract.json" in doctor
