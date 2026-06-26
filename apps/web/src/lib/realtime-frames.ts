import {
  MAX_WIRE_AUDIO_PCM_BYTES,
  MAX_WIRE_FRAME_BYTES,
  MAX_WIRE_TEXT_PAYLOAD_BYTES,
} from "@/lib/realtime-constants";

export type ReadyRealtimeFrame = {
  type: "ready";
  lang?: string | null;
};

export type AudioRealtimeFrame = {
  type: "audio";
  lang?: string | null;
  payload: string;
  is_final?: boolean;
};

export type CaptionRealtimeFrame = {
  type: "caption";
  lang?: string | null;
  payload: string;
  is_final?: boolean;
};

export type AttendeesRealtimeFrame = {
  type: "attendees";
  count: number;
};

export type CloseRealtimeFrame = {
  type: "close";
  code?: number;
  reason?: string;
};

export type ClientRealtimeFrame =
  | ReadyRealtimeFrame
  | AudioRealtimeFrame
  | CaptionRealtimeFrame
  | AttendeesRealtimeFrame
  | CloseRealtimeFrame;

export type InvalidWireFrameReason =
  | "non-text-data"
  | "frame-too-large"
  | "malformed-json"
  | "invalid-envelope"
  | "invalid-lang"
  | "invalid-payload"
  | "payload-too-large"
  | "invalid-reason"
  | "reason-too-large"
  | "invalid-is-final"
  | "audio-payload-missing"
  | "audio-base64-invalid"
  | "audio-pcm-invalid"
  | "audio-too-large"
  | "caption-payload-missing"
  | "attendees-count-invalid";

export type ParseWireFrameResult =
  | { kind: "frame"; frame: ClientRealtimeFrame }
  | { kind: "ignore" }
  | { kind: "invalid"; reason: InvalidWireFrameReason };

const MAX_LANG_BYTES = 64;
const MAX_REASON_BYTES = 512;
const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_WIRE_AUDIO_PCM_BYTES / 3) * 4;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
type StringFieldResult =
  | { ok: true; value?: string }
  | { ok: false; reason: "invalid" | "too-large" };

type NullableStringFieldResult =
  | { ok: true; value?: string | null }
  | { ok: false; reason: "invalid" | "too-large" };

type AudioPayloadResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "audio-base64-invalid"
        | "audio-pcm-invalid"
        | "audio-too-large";
    };

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

function readOptionalString(value: unknown, maxBytes: number): StringFieldResult {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string") return { ok: false, reason: "invalid" };
  if (exceedsUtf8ByteLimit(value, maxBytes)) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, value };
}

function readOptionalNullableString(
  value: unknown,
  maxBytes: number,
): NullableStringFieldResult {
  if (value === undefined) return { ok: true };
  if (value === null) return { ok: true, value: null };
  return readOptionalString(value, maxBytes);
}

function decodedBase64ByteLength(value: string): number | null {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function validateAudioPayload(value: string): AudioPayloadResult {
  const decodedBytes = decodedBase64ByteLength(value);
  if (decodedBytes === null) {
    return { ok: false, reason: "audio-base64-invalid" };
  }
  if (decodedBytes % 2 !== 0) {
    return { ok: false, reason: "audio-pcm-invalid" };
  }
  if (decodedBytes > MAX_WIRE_AUDIO_PCM_BYTES) {
    return { ok: false, reason: "audio-too-large" };
  }
  return { ok: true };
}

function invalid(reason: InvalidWireFrameReason): ParseWireFrameResult {
  return { kind: "invalid", reason };
}

export function parseWireFrame(data: unknown): ParseWireFrameResult {
  if (typeof data !== "string") {
    return invalid("non-text-data");
  }
  if (exceedsUtf8ByteLimit(data, MAX_WIRE_FRAME_BYTES)) {
    return invalid("frame-too-large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return invalid("malformed-json");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return invalid("invalid-envelope");
  }
  if (!isWireFrameType(parsed.type)) return { kind: "ignore" };

  const payloadLimit =
    parsed.type === "audio" ? MAX_AUDIO_BASE64_CHARS : MAX_WIRE_TEXT_PAYLOAD_BYTES;
  const lang = readOptionalNullableString(parsed.lang, MAX_LANG_BYTES);
  const payload = readOptionalString(parsed.payload, payloadLimit);
  const reason = readOptionalString(parsed.reason, MAX_REASON_BYTES);
  if (!lang.ok) return invalid("invalid-lang");
  if (!payload.ok) {
    return invalid(
      parsed.type === "audio" && payload.reason === "too-large"
        ? "audio-too-large"
        : payload.reason === "too-large"
          ? "payload-too-large"
          : "invalid-payload",
    );
  }
  if (!reason.ok) {
    return invalid(reason.reason === "too-large" ? "reason-too-large" : "invalid-reason");
  }

  if (parsed.is_final !== undefined && typeof parsed.is_final !== "boolean") {
    return invalid("invalid-is-final");
  }
  const isFinal = parsed.is_final;

  if (parsed.type === "ready") {
    return { kind: "frame", frame: { type: "ready", lang: lang.value } };
  }

  if (parsed.type === "audio") {
    if (!payload.value) return invalid("audio-payload-missing");
    const audioResult = validateAudioPayload(payload.value);
    if (!audioResult.ok) return invalid(audioResult.reason);
    return {
      kind: "frame",
      frame: {
        type: "audio",
        lang: lang.value,
        payload: payload.value,
        is_final: isFinal,
      },
    };
  }

  if (parsed.type === "caption") {
    if (payload.value === undefined) return invalid("caption-payload-missing");
    return {
      kind: "frame",
      frame: {
        type: "caption",
        lang: lang.value,
        payload: payload.value,
        is_final: isFinal,
      },
    };
  }

  const count = safeInteger(parsed.count);
  if (parsed.type === "attendees") {
    if (count === undefined || count < 0) return invalid("attendees-count-invalid");
    return { kind: "frame", frame: { type: "attendees", count } };
  }

  return {
    kind: "frame",
    frame: {
      type: "close",
      code: safeInteger(parsed.code),
      reason: reason.value,
    },
  };
}
