export type FileStatus = "uploading" | "complete" | "error";

export interface FileMetadata {
  key: string;
  filename: string;
  folder: string;
  size_bytes: number;
  size_human: string;
  content_type: string;
  uploaded_at: string;
  url: string | null;
}

export interface FileMetadataDetail {
  filename: string;
  size_bytes: number;
  size_human: string;
  mime_type: string;
  extension: string;
  md5: string;
  sha256: string;
  uploaded_at: string;
  // Audio-specific (populated when content_type starts with audio/)
  duration_ms: number | null;
  sample_rate: number | null;
  channels: number | null;
  bit_depth: number | null;
  codec: string | null;
}

export interface DailyEventCount {
  date: string;
  events: number;
  duration_ms: number;
}

export interface EventStats {
  total_events: number;
  events_today: number;
  live_events: number;
  total_duration_ms: number;
  total_size_bytes: number;
  total_size_human: string;
  languages: Record<string, number>;
  formats: Record<string, number>;
  attendee_peak: number;
}

export type EventStatus = "scheduled" | "live" | "ended";

export interface EventArtifact {
  key: string;
  kind: string;
  lang: string | null;
  size_bytes: number;
  size_human: string;
  content_type: string;
  created_at: string;
}

export interface Event {
  id: string;
  title: string;
  status: EventStatus;
  source_language: string;
  target_languages: string[];
  persist_translated_audio: boolean;
  glossary_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  attendee_peak: number;
  artifacts: EventArtifact[];
}

export interface EventCreateRequest {
  id: string;
  title: string;
  source_language: string;
  target_languages: string[];
  persist_translated_audio?: boolean;
  glossary_id?: string | null;
}

export interface Language {
  code: string;
  display_name: string;
}

export interface GlossaryTerm {
  term: string;
  translations: Record<string, string>;
  note?: string | null;
}

export interface Glossary {
  id: string;
  name: string;
  source_language: string;
  terms: GlossaryTerm[];
  created_at: string;
  updated_at: string;
}
