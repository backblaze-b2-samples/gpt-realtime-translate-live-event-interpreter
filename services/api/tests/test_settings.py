from app.config.settings import Settings


def test_b2_settings_use_standard_env_names(monkeypatch):
    monkeypatch.setenv("B2_APPLICATION_KEY_ID", "standard-key-id")
    monkeypatch.setenv("B2_APPLICATION_KEY", "standard-application-key")
    monkeypatch.setenv("B2_BUCKET_NAME", "standard-bucket")
    monkeypatch.setenv("B2_REGION", "us-test-001")
    monkeypatch.setenv("B2_PUBLIC_URL_BASE", "https://cdn.example/bucket")

    settings = Settings(_env_file=None)

    assert settings.b2_application_key_id == "standard-key-id"
    assert settings.b2_application_key == "standard-application-key"
    assert settings.b2_bucket_name == "standard-bucket"
    assert settings.b2_region == "us-test-001"
    assert settings.b2_public_url_base == "https://cdn.example/bucket"
    assert settings.b2_endpoint == "https://s3.us-test-001.backblazeb2.com"
