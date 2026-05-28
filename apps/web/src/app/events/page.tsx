import Link from "next/link";
import { Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EventsView } from "@/components/events/events-view";

export default function EventsPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Events</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Every live-interpretation event archived under{" "}
            <code className="font-mono text-xs">events/</code> in B2 — source
            audio, transcripts, captions, and per-language artifacts.
          </p>
        </div>
        <Button asChild size="sm" className="h-8">
          <Link href="/live">
            <Radio className="h-3.5 w-3.5" />
            Start live event
          </Link>
        </Button>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <EventsView />
      </div>
    </div>
  );
}
