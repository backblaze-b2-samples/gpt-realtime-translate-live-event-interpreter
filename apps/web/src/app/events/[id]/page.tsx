"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft, Download, FileText, Headphones } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Waveform } from "@/components/events/waveform";
import {
  ApiError,
  getEventCaptionsUrl,
  getEventSourceAudioUrl,
  getEventTranscriptUrl,
} from "@/lib/api-client";
import { useEvent } from "@/lib/queries";
import { formatDate, formatDuration } from "@/lib/utils";
import { toast } from "sonner";
import { useState } from "react";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EventDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: event, isLoading, error, refetch } = useEvent(id);
  const [sourceAudioUrl, setSourceAudioUrl] = useState<string | null>(null);

  const handlePlaySource = async () => {
    try {
      const { url } = await getEventSourceAudioUrl(id);
      setSourceAudioUrl(url);
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.message : "Failed to load source audio";
      toast.error(detail);
    }
  };

  const handleDownloadTranscript = async (lang?: string) => {
    try {
      const { url } = await getEventTranscriptUrl(id, lang);
      window.open(url, "_blank");
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.message : "Failed to load transcript";
      toast.error(detail);
    }
  };

  const handleDownloadCaptions = async (lang: string, fmt: "vtt" | "srt") => {
    try {
      const { url } = await getEventCaptionsUrl(id, lang, fmt);
      window.open(url, "_blank");
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.message : "Failed to load captions";
      toast.error(detail);
    }
  };

  return (
    <div className="space-y-6">
      <div className="animate-fade-in flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/events">
            <ArrowLeft className="h-3.5 w-3.5" />
            All events
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : error ? (
        <Card>
          <CardContent className="p-0">
            <ErrorState error={error} onRetry={() => refetch()} />
          </CardContent>
        </Card>
      ) : !event ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title="Event not found"
              description="No event with this id exists in the bucket."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="border-b border-border pb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="page-title">{event.title}</h1>
              <p className="text-xs text-muted-foreground mt-1.5 font-mono">
                {event.id}
              </p>
              <p className="text-sm text-muted-foreground mt-1.5">
                {formatDate(event.created_at)}
                {event.duration_ms ? ` · ${formatDuration(event.duration_ms)}` : ""}
              </p>
            </div>
            <Badge
              variant={
                event.status === "live"
                  ? "default"
                  : event.status === "scheduled"
                    ? "secondary"
                    : "outline"
              }
            >
              {event.status}
            </Badge>
          </div>

          {/* Source audio */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Source audio</h2>
                  <p className="text-xs text-muted-foreground">
                    {event.source_language || "?"}
                  </p>
                </div>
                {!sourceAudioUrl ? (
                  <Button size="sm" variant="outline" onClick={handlePlaySource}>
                    <Headphones className="h-3.5 w-3.5" />
                    Play
                  </Button>
                ) : null}
              </div>
              <Waveform durationMs={event.duration_ms} />
              {sourceAudioUrl ? (
                <audio controls src={sourceAudioUrl} className="w-full" autoPlay />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadTranscript()}
              >
                <FileText className="h-3.5 w-3.5" />
                Source transcript
              </Button>
            </CardContent>
          </Card>

          {/* Per-language artifacts */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {event.target_languages.length === 0 ? (
              <Card>
                <CardContent className="p-0">
                  <EmptyState
                    icon={FileText}
                    title="No target languages"
                    description="This event was archived without any translated artifacts."
                  />
                </CardContent>
              </Card>
            ) : (
              event.target_languages.map((lang) => (
                <Card key={lang}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold font-mono">{lang}</h3>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadTranscript(lang)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        TXT
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadCaptions(lang, "vtt")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        VTT
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadCaptions(lang, "srt")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        SRT
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <Card>
            <CardContent className="p-4 space-y-2">
              <h2 className="text-sm font-semibold">Artifacts in B2</h2>
              <p className="text-xs text-muted-foreground">
                {event.artifacts.length === 0
                  ? "No artifacts persisted yet."
                  : `${event.artifacts.length} object(s) under events/${event.id}/`}
              </p>
              <ul className="text-xs font-mono text-muted-foreground space-y-1">
                {event.artifacts.map((artifact) => (
                  <li key={artifact.key} className="truncate">
                    {artifact.key} ({artifact.size_human})
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
