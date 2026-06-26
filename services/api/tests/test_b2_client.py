from types import SimpleNamespace

from app.repo import b2_client


def test_s3_client_uses_none_for_empty_endpoint(monkeypatch):
    captured = {}

    def fake_client(_service_name, **kwargs):
        captured.update(kwargs)
        return object()

    b2_client.get_s3_client.cache_clear()
    monkeypatch.setattr(b2_client.boto3, "client", fake_client)
    monkeypatch.setattr(
        b2_client,
        "settings",
        SimpleNamespace(
            b2_endpoint="",
            b2_region="",
            b2_application_key_id="key-id",
            b2_application_key="application-key",
        ),
    )

    try:
        b2_client.get_s3_client()
    finally:
        b2_client.get_s3_client.cache_clear()

    assert captured["endpoint_url"] is None
