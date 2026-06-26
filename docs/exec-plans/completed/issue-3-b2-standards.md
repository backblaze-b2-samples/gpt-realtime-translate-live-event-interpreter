# Issue 3 B2 Standards Correction

**Issue:** <https://github.com/backblaze-b2-samples/gpt-realtime-translate-live-event-interpreter/issues/3>

## Summary

The initial scaffold used the older B2 sample env names. Issue #3 updates the
runtime, local doctor, examples, and deployment docs to the current standard:

- `B2_APPLICATION_KEY_ID`
- `B2_APPLICATION_KEY`
- `B2_BUCKET_NAME`
- `B2_REGION`
- `B2_PUBLIC_URL_BASE`

`B2_PUBLIC_URL_BASE` is optional. Private buckets continue to use presigned URLs.

## Compatibility

The code accepts legacy `B2_KEY_ID` and `B2_PUBLIC_URL` for one migration
window, preferring the standard names when both are present. Stale `B2_ENDPOINT`
is ignored because the S3 endpoint is derived from validated `B2_REGION`.

`B2_REGION` is validated before constructing the B2 S3 endpoint so malformed
values cannot alter the outbound S3 host.

## Deployment Sequence

1. Add the standard B2 variables alongside existing legacy variables.
2. Deploy the compatible code that accepts both old and new names.
3. Confirm startup emits no legacy-in-use warnings.
4. Remove legacy variables after all old instances have drained.
