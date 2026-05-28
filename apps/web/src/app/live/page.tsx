"use client";

import { Radio } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveDefaults } from "@/lib/queries";

export default function LivePage() {
  // Seeded from `GET /config/defaults` — the speaker-console form will use
  // these once the realtime wiring lands. Surfacing them now lets the
  // scaffold prove the round-trip works end-to-end before the WebSocket
  // handlers come online.
  const { data: defaults, isLoading } = useLiveDefaults();

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Speaker console</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Configure source language, target languages, and an optional glossary,
          then go live. Source audio + per-language artifacts archive to B2 as
          the event runs.
        </p>
      </div>
      <Card className="animate-fade-in-up stagger-2">
        <CardContent className="p-0">
          <EmptyState
            icon={Radio}
            title="Live interpretation — coming soon"
            description={
              "The speaker console UI lands in a follow-up exec plan. " +
              "When wired, this page will: request microphone permission, " +
              "open the WebSocket at /events/{id}/speaker, stream source " +
              "audio chunks upstream, and show live caption previews + " +
              "attendee count. The backend route exists today and returns " +
              "a structured 'not yet implemented' close frame so you can " +
              "test the layering."
            }
          />
        </CardContent>
      </Card>
      <Card className="animate-fade-in-up stagger-3">
        <CardContent className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Form defaults (from .env)</h2>
          {isLoading || !defaults ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">
                  Source language
                </dt>
                <dd className="font-mono">{defaults.default_source_language}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">
                  Target languages
                </dt>
                <dd className="font-mono">
                  {defaults.default_target_languages.join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground uppercase tracking-wider text-[10px]">
                  Persist translated audio
                </dt>
                <dd className="font-mono">
                  {defaults.persist_translated_audio_default ? "on" : "off"}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
