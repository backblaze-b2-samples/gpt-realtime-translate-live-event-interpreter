"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EventCard } from "@/components/events/event-card";
import { Section } from "./section";
import type { Event } from "@gpt-realtime-translate-live-event-interpreter/shared";

// Static demo event — ids, sizes, timestamps are fabricated. Open / Delete
// will toast a failure when clicked since the id doesn't resolve in B2;
// that's the intended showcase behavior.
const sampleEvent: Event = {
  id: "keynote-2026-q1",
  title: "Q1 Engineering All-Hands",
  status: "ended",
  source_language: "en",
  target_languages: ["es", "fr", "ja"],
  persist_translated_audio: false,
  glossary_id: null,
  created_at: "2026-05-20T14:23:00.000Z",
  started_at: "2026-05-20T14:30:00.000Z",
  ended_at: "2026-05-20T15:15:00.000Z",
  duration_ms: 45 * 60 * 1000,
  attendee_peak: 124,
  artifacts: [],
};

export function DesignLibraryCard() {
  return (
    <Section
      id="event-card"
      title="Event Card"
      description="The default Events primitive for the live-interpretation app. Renders an event with status badge, source language, target-language chips, attendee peak, and Open / Listen / Delete actions. Compose into any grid scoped to the events/ prefix."
    >
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Sample event</CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <EventCard event={sampleEvent} />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Source: <code className="font-mono">apps/web/src/components/events/event-card.tsx</code> ·
            also documented in <code className="font-mono">docs/features/event-archive.md</code>.
          </p>
        </CardContent>
      </Card>
    </Section>
  );
}
