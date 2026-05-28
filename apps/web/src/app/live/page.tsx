import { Radio } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function LivePage() {
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
    </div>
  );
}
