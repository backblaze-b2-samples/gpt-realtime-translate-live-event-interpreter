"""B2 helpers scoped to the events prefix.

Live interpretation produces a fan-out of artifacts per event under
`events/<event-id>/...`. These helpers sit alongside `b2_client.py` so the
generic explorer keeps its own listing / head / delete helpers while the
events path can grow extra affordances (parallel HEAD, presigned playback /
download, cascade-delete of an entire prefix) without bloating the file.
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import quote

from botocore.exceptions import ClientError

from app.config import settings
from app.repo.b2_client import get_s3_client

EVENTS_PREFIX = "events/"
GLOSSARIES_PREFIX = "glossaries/"


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def list_event_prefixes(max_keys: int = 1000) -> list[str]:
    """Return the set of `events/<id>/` common prefixes in the bucket.

    Uses `Delimiter="/"` to enumerate event IDs without paging through every
    artifact. Returns prefix strings (e.g. `events/keynote-2026-q1/`) — the
    caller strips the prefix + trailing slash to recover the event id.
    """
    client = get_s3_client()
    out: list[str] = []
    kwargs: dict[str, Any] = {
        "Bucket": settings.b2_bucket_name,
        "Prefix": EVENTS_PREFIX,
        "Delimiter": "/",
        "MaxKeys": max_keys,
    }
    try:
        while True:
            response = client.list_objects_v2(**kwargs)
            for cp in response.get("CommonPrefixes", []) or []:
                p = cp.get("Prefix")
                if p:
                    out.append(p)
            if not response.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
    except ClientError as e:
        raise RuntimeError(f"B2 events list failed: {e}") from e
    return out


def list_event_objects(event_id: str, max_keys: int = 1000) -> list[dict]:
    """List raw S3 objects under a single event's prefix.

    Returned dicts contain at least: Key, Size, LastModified. Callers in
    service/ shape these into typed models — repo stays a thin data-access
    layer.
    """
    client = get_s3_client()
    contents: list[dict] = []
    prefix = f"{EVENTS_PREFIX}{event_id}/"
    kwargs: dict[str, Any] = {
        "Bucket": settings.b2_bucket_name,
        "Prefix": prefix,
        "MaxKeys": max_keys,
    }
    try:
        while True:
            response = client.list_objects_v2(**kwargs)
            contents.extend(response.get("Contents", []))
            if not response.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
    except ClientError as e:
        raise RuntimeError(f"B2 event object list failed for '{event_id}': {e}") from e
    return contents


# ---------------------------------------------------------------------------
# HEAD
# ---------------------------------------------------------------------------


def head_event_object(key: str) -> dict | None:
    """Return the raw head_object response for an event-prefixed key, or None."""
    client = get_s3_client()
    try:
        return client.head_object(Bucket=settings.b2_bucket_name, Key=key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            return None
        raise


def head_event_artifacts_parallel(
    keys: list[str], max_workers: int = 10
) -> dict[str, dict]:
    """Issue HEAD for each key in parallel; map key -> head response.

    Missing keys (404) are silently dropped — `list_objects_v2` can race a
    concurrent delete, and a missing aggregate entry is preferable to a
    500 on the dashboard. Other errors bubble up.
    """
    if not keys:
        return {}
    client = get_s3_client()
    bucket = settings.b2_bucket_name

    def _one(key: str) -> tuple[str, dict | None]:
        try:
            return key, client.head_object(Bucket=bucket, Key=key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey"):
                return key, None
            raise

    out: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        for key, head in pool.map(_one, keys):
            if head is not None:
                out[key] = head
    return out


# ---------------------------------------------------------------------------
# PUT / GET
# ---------------------------------------------------------------------------


def put_event_object(
    key: str,
    body: bytes,
    content_type: str,
    metadata: dict[str, str] | None = None,
) -> None:
    """Persist a single event artifact (manifest, transcript chunk, audio).

    Raises RuntimeError on S3 failure. Callers in service/ build the key,
    serialize the payload, and choose the content type — repo stays generic.
    """
    client = get_s3_client()
    params: dict[str, Any] = {
        "Bucket": settings.b2_bucket_name,
        "Key": key,
        "Body": body,
        "ContentType": content_type,
    }
    if metadata:
        params["Metadata"] = metadata
    try:
        client.put_object(**params)
    except ClientError as e:
        raise RuntimeError(f"B2 event put failed for '{key}': {e}") from e


def get_event_object_bytes(key: str) -> bytes | None:
    """Fetch the raw bytes of an event-prefixed object, or None if missing."""
    client = get_s3_client()
    try:
        response = client.get_object(Bucket=settings.b2_bucket_name, Key=key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            return None
        raise
    body = response.get("Body")
    return body.read() if body is not None else None


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


def delete_event_object(key: str) -> None:
    """Delete a single event artifact. Raises RuntimeError on failure."""
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.b2_bucket_name, Key=key)
    except ClientError as e:
        raise RuntimeError(f"B2 event delete failed for '{key}': {e}") from e


def delete_event_prefix(event_id: str) -> tuple[list[str], list[dict]]:
    """Cascade-delete every artifact under `events/<event-id>/`.

    Lists the prefix, then issues batched `DeleteObjects` calls (1000 keys
    per batch — the S3 API cap). Returns `(deleted_keys, errors)` so the
    UI can show partial success. An empty prefix is a no-op.
    """
    objects = list_event_objects(event_id, max_keys=10_000)
    keys = [obj["Key"] for obj in objects]
    if not keys:
        return [], []
    client = get_s3_client()
    deleted: list[str] = []
    errors: list[dict] = []
    for i in range(0, len(keys), 1000):
        chunk = keys[i : i + 1000]
        try:
            response = client.delete_objects(
                Bucket=settings.b2_bucket_name,
                Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": False},
            )
        except ClientError as e:
            raise RuntimeError(
                f"B2 event prefix delete failed for '{event_id}': {e}"
            ) from e
        deleted.extend(d["Key"] for d in response.get("Deleted", []))
        for err in response.get("Errors", []):
            errors.append(
                {
                    "Key": err.get("Key", ""),
                    "Code": err.get("Code", ""),
                    "Message": err.get("Message", ""),
                }
            )
    return deleted, errors


# ---------------------------------------------------------------------------
# Presigned URLs
# ---------------------------------------------------------------------------


def presign_event_playback(key: str, expires_in: int = 600) -> str:
    """Inline-playback presigned GET for source / translated audio."""
    client = get_s3_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.b2_bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )
    except ClientError as e:
        raise RuntimeError(f"B2 presign failed for '{key}': {e}") from e


def presign_event_download(
    key: str, filename: str | None = None, expires_in: int = 600
) -> str:
    """Presigned GET with `Content-Disposition: attachment` for downloads."""
    client = get_s3_client()
    params: dict[str, Any] = {"Bucket": settings.b2_bucket_name, "Key": key}
    if filename:
        encoded = quote(filename, safe="")
        params["ResponseContentDisposition"] = (
            f'attachment; filename="{encoded}"; filename*=UTF-8\'\'{encoded}'
        )
    else:
        params["ResponseContentDisposition"] = "attachment"
    try:
        return client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
    except ClientError as e:
        raise RuntimeError(f"B2 presign failed for '{key}': {e}") from e


# ---------------------------------------------------------------------------
# Glossary helpers (share the events client, distinct prefix)
# ---------------------------------------------------------------------------


def list_glossary_objects(max_keys: int = 1000) -> list[dict]:
    """List raw S3 objects under the glossaries prefix.

    `glossaries/<id>.json` are flat (no hierarchy), so a single list call is
    enough for reasonable scales. Pages defensively just in case.
    """
    client = get_s3_client()
    contents: list[dict] = []
    kwargs: dict[str, Any] = {
        "Bucket": settings.b2_bucket_name,
        "Prefix": GLOSSARIES_PREFIX,
        "MaxKeys": max_keys,
    }
    try:
        while True:
            response = client.list_objects_v2(**kwargs)
            contents.extend(response.get("Contents", []))
            if not response.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
    except ClientError as e:
        raise RuntimeError(f"B2 glossary list failed: {e}") from e
    return contents
