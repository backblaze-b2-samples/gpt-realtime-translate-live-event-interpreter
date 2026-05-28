"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  bulkDeleteFiles,
  createEvent,
  deleteEvent,
  deleteFile,
  deleteGlossary,
  getEvent,
  getEventActivity,
  getEvents,
  getFiles,
  getFileStats,
  getGlossaries,
  getGlossary,
  getPreviewUrl,
  upsertGlossary,
} from "@/lib/api-client";
import type {
  Event,
  EventCreateRequest,
  FileMetadata,
  Glossary,
  GlossaryTerm,
} from "@gpt-realtime-translate-live-event-interpreter/shared";

// Single source of truth for query keys. Keep these tightly scoped so that
// invalidating "files" doesn't blow away unrelated caches, and so an IDE
// "find usages" of `qk.files` reveals every consumer.
export const qk = {
  all: ["b2"] as const,
  files: (prefix?: string, limit?: number) =>
    [...qk.all, "files", prefix ?? "", limit ?? 100] as const,
  stats: () => [...qk.all, "stats"] as const,
  eventActivity: (days: number) =>
    [...qk.all, "stats", "activity", days] as const,
  preview: (key: string) => [...qk.all, "preview", key] as const,
  events: (limit?: number) => [...qk.all, "events", limit ?? 100] as const,
  event: (id: string) => [...qk.all, "event", id] as const,
  glossaries: () => [...qk.all, "glossaries"] as const,
  glossary: (id: string) => [...qk.all, "glossary", id] as const,
};

// --- Files (full-bucket explorer; non-negotiable keep) ---

export function useFiles(prefix = "", limit = 100) {
  return useQuery<FileMetadata[], ApiError>({
    queryKey: qk.files(prefix, limit),
    queryFn: () => getFiles(prefix, limit),
  });
}

export function useFileStats() {
  return useQuery({
    queryKey: qk.stats(),
    queryFn: getFileStats,
  });
}

export function useEventActivity(days = 7) {
  return useQuery({
    queryKey: qk.eventActivity(days),
    queryFn: () => getEventActivity(days),
  });
}

// Presigned preview URL — only fetched when `enabled` is true (e.g., when
// the dialog opens for a specific file).
export function usePreviewUrl(key: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(key ?? ""),
    queryFn: () => getPreviewUrl(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileKey: string) => deleteFile(fileKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

export function useBulkDeleteFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[]) => bulkDeleteFiles(keys),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// --- Events ---

export function useEvents(limit = 100) {
  return useQuery<Event[], ApiError>({
    queryKey: qk.events(limit),
    queryFn: () => getEvents(limit),
  });
}

export function useEvent(id: string | undefined) {
  return useQuery<Event, ApiError>({
    queryKey: qk.event(id ?? ""),
    queryFn: () => getEvent(id as string),
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: EventCreateRequest) => createEvent(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// --- Glossaries ---

export function useGlossaries() {
  return useQuery<Glossary[], ApiError>({
    queryKey: qk.glossaries(),
    queryFn: getGlossaries,
  });
}

export function useGlossary(id: string | undefined) {
  return useQuery<Glossary, ApiError>({
    queryKey: qk.glossary(id ?? ""),
    queryFn: () => getGlossary(id as string),
    enabled: !!id,
  });
}

export function useUpsertGlossary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: {
      id: string;
      name: string;
      source_language: string;
      terms: GlossaryTerm[];
    }) => upsertGlossary(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.glossaries() });
    },
  });
}

export function useDeleteGlossary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteGlossary(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.glossaries() });
    },
  });
}
