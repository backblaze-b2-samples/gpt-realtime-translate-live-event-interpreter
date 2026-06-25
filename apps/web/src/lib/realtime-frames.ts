export interface WireFrame {
  type: "ready" | "audio" | "caption" | "attendees" | "close";
  lang?: string | null;
  payload?: string;
  is_final?: boolean;
  count?: number;
  code?: number;
  reason?: string;
}

const WIRE_FRAME_TYPES = new Set<WireFrame["type"]>([
  "ready",
  "audio",
  "caption",
  "attendees",
  "close",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWireFrameType(value: unknown): value is WireFrame["type"] {
  return (
    typeof value === "string" &&
    WIRE_FRAME_TYPES.has(value as WireFrame["type"])
  );
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function parseWireFrame(data: unknown): WireFrame | null {
  if (typeof data !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isWireFrameType(parsed.type)) return null;

  return {
    type: parsed.type,
    lang:
      typeof parsed.lang === "string" || parsed.lang === null
        ? parsed.lang
        : undefined,
    payload: typeof parsed.payload === "string" ? parsed.payload : undefined,
    is_final: typeof parsed.is_final === "boolean" ? parsed.is_final : undefined,
    count: safeInteger(parsed.count),
    code: safeInteger(parsed.code),
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
  };
}
