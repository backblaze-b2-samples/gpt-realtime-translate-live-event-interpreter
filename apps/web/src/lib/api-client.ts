import type {
  DailyEventCount,
  Event,
  EventCreateRequest,
  EventStats,
  FileMetadata,
  Glossary,
  GlossaryTerm,
  LiveDefaults,
} from "@gpt-realtime-translate-live-event-interpreter/shared";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** WebSocket origin derived from API_BASE (http -> ws, https -> wss). */
export const WS_BASE = API_BASE.replace(/^http/, "ws");

/** Build an absolute WebSocket URL for a backend path (e.g. `/events/x/speaker`). */
export function wsUrl(path: string): string {
  return `${WS_BASE}${path}`;
}

/** Typed API error with HTTP status code for caller-side branching. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True for 408, 429, 500, 502, 503, 504 — worth retrying. */
  get isRetryable(): boolean {
    return [408, 429, 500, 502, 503, 504].includes(this.status);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    // Network failure (offline, DNS, CORS, etc.)
    throw new ApiError("Network error — check your connection", 0);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.detail || `API error: ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

// --- Health ---

export async function getHealth() {
  return apiFetch<{ status: string; b2_connected: boolean }>("/health");
}

// --- Config (defaults consumed by the /live speaker console) ---

export async function getLiveDefaults() {
  return apiFetch<LiveDefaults>("/config/defaults");
}

// --- Files (full-bucket explorer; non-negotiable keep) ---

export async function getFiles(prefix = "", limit = 100) {
  return apiFetch<FileMetadata[]>(
    `/files?prefix=${encodeURIComponent(prefix)}&limit=${limit}`,
  );
}

export async function getFileStats() {
  return apiFetch<EventStats>("/files/stats");
}

export async function getEventActivity(days = 7) {
  return apiFetch<DailyEventCount[]>(`/files/stats/activity?days=${days}`);
}

export async function getFile(key: string) {
  return apiFetch<FileMetadata>(`/files/${key}`);
}

export async function getDownloadUrl(key: string) {
  return apiFetch<{ url: string }>(`/files/${key}/download`);
}

/** Preview-only presigned URL — does NOT increment the download counter. */
export async function getPreviewUrl(key: string) {
  return apiFetch<{ url: string }>(`/files/${key}/preview`);
}

export async function deleteFile(key: string) {
  return apiFetch<{ deleted: boolean; key: string }>(`/files/${key}`, {
    method: "DELETE",
  });
}

export interface BulkDeleteError {
  Key: string;
  Code: string;
  Message: string;
}

export interface BulkDeleteResult {
  deleted: string[];
  errors: BulkDeleteError[];
}

export async function bulkDeleteFiles(keys: string[]) {
  return apiFetch<BulkDeleteResult>("/files/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
}

// --- Events ---

export async function getEvents(limit = 100) {
  return apiFetch<Event[]>(`/events?limit=${limit}`);
}

export async function getEvent(id: string) {
  return apiFetch<Event>(`/events/${encodeURIComponent(id)}`);
}

export async function createEvent(req: EventCreateRequest) {
  return apiFetch<Event>("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function deleteEvent(id: string) {
  return apiFetch<BulkDeleteResult>(`/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getEventSourceAudioUrl(id: string) {
  return apiFetch<{ url: string; expires_in: number }>(
    `/events/${encodeURIComponent(id)}/source-audio`,
  );
}

export async function getEventTranscriptUrl(id: string, lang?: string) {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return apiFetch<{ url: string; expires_in: number }>(
    `/events/${encodeURIComponent(id)}/transcript${qs}`,
  );
}

export async function getEventCaptionsUrl(
  id: string,
  lang: string,
  fmt: "vtt" | "srt" = "vtt",
) {
  return apiFetch<{ url: string; expires_in: number }>(
    `/events/${encodeURIComponent(id)}/captions?lang=${encodeURIComponent(
      lang,
    )}&fmt=${fmt}`,
  );
}

// --- Glossaries ---

export async function getGlossaries() {
  return apiFetch<Glossary[]>("/glossaries");
}

export async function getGlossary(id: string) {
  return apiFetch<Glossary>(`/glossaries/${encodeURIComponent(id)}`);
}

export async function upsertGlossary(req: {
  id: string;
  name: string;
  source_language: string;
  terms: GlossaryTerm[];
}) {
  return apiFetch<Glossary>("/glossaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export async function deleteGlossary(id: string) {
  return apiFetch<{ deleted: boolean; id: string }>(
    `/glossaries/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
