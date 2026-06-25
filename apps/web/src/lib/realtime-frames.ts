type ClientRealtimeFrame = {
  type: "ready" | "audio" | "caption" | "attendees" | "close";
  lang?: string | null;
  payload?: string;
  is_final?: boolean;
  count?: number;
  code?: number;
  reason?: string;
};

type ParseWireFrameResult =
  | { kind: "frame"; frame: ClientRealtimeFrame }
  | { kind: "ignore" }
  | { kind: "invalid" };

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_TEXT_PAYLOAD_BYTES = 16 * 1024;
const MAX_LANG_BYTES = 64;
const MAX_REASON_BYTES = 512;
const MAX_AUDIO_PCM_BYTES = 96_000;
const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_AUDIO_PCM_BYTES / 3) * 4;
const INVALID_FIELD = Symbol("invalid-field");
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const WIRE_FRAME_TYPES = new Set<ClientRealtimeFrame["type"]>([
  "ready",
  "audio",
  "caption",
  "attendees",
  "close",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWireFrameType(value: string): value is ClientRealtimeFrame["type"] {
  return WIRE_FRAME_TYPES.has(value as ClientRealtimeFrame["type"]);
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function exceedsUtf8ByteLimit(value: string, maxBytes: number): boolean {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
    if (bytes > maxBytes) return true;
  }
  return false;
}

function readOptionalString(
  value: unknown,
  maxBytes: number,
): string | undefined | typeof INVALID_FIELD {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || exceedsUtf8ByteLimit(value, maxBytes)) {
    return INVALID_FIELD;
  }
  return value;
}

function readOptionalNullableString(
  value: unknown,
  maxBytes: number,
): string | null | undefined | typeof INVALID_FIELD {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return readOptionalString(value, maxBytes);
}

function decodedBase64ByteLength(value: string): number | null {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function isValidAudioPayload(value: string): boolean {
  const decodedBytes = decodedBase64ByteLength(value);
  return (
    decodedBytes !== null &&
    decodedBytes % 2 === 0 &&
    decodedBytes <= MAX_AUDIO_PCM_BYTES
  );
}

export function parseWireFrame(data: unknown): ParseWireFrameResult {
  if (typeof data !== "string" || exceedsUtf8ByteLimit(data, MAX_FRAME_BYTES)) {
    return { kind: "invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { kind: "invalid" };
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { kind: "invalid" };
  }
  if (!isWireFrameType(parsed.type)) return { kind: "ignore" };

  const payloadLimit =
    parsed.type === "audio" ? MAX_AUDIO_BASE64_CHARS : MAX_TEXT_PAYLOAD_BYTES;
  const lang = readOptionalNullableString(parsed.lang, MAX_LANG_BYTES);
  const payload = readOptionalString(parsed.payload, payloadLimit);
  const reason = readOptionalString(parsed.reason, MAX_REASON_BYTES);
  if (
    lang === INVALID_FIELD ||
    payload === INVALID_FIELD ||
    reason === INVALID_FIELD
  ) {
    return { kind: "invalid" };
  }

  if (parsed.type === "audio" && (!payload || !isValidAudioPayload(payload))) {
    return { kind: "invalid" };
  }
  if (parsed.type === "caption" && payload === undefined) {
    return { kind: "invalid" };
  }

  const count = safeInteger(parsed.count);
  if (parsed.type === "attendees" && (count === undefined || count < 0)) {
    return { kind: "invalid" };
  }

  return {
    kind: "frame",
    frame: {
      type: parsed.type,
      lang,
      payload,
      is_final:
        typeof parsed.is_final === "boolean" ? parsed.is_final : undefined,
      count,
      code: safeInteger(parsed.code),
      reason,
    },
  };
}
