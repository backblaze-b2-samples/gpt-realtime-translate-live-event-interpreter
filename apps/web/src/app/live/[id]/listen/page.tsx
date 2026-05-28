"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft, Headphones } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ListenPage({ params }: PageProps) {
  const { id } = use(params);

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

      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Attendee — listen</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Event <code className="font-mono text-xs">{id}</code>
        </p>
      </div>

      <Card className="animate-fade-in-up stagger-2">
        <CardContent className="p-0">
          <EmptyState
            icon={Headphones}
            title="Listen — coming soon"
            description={
              "When wired, this page will: open the WebSocket at " +
              "/events/{id}/listen?lang=<bcp47>, render a language picker, " +
              "feed translated audio chunks into an inline <audio> via " +
              "MediaSource, and overlay live captions. The backend already " +
              "validates inputs and surfaces a structured close frame so " +
              "the layering tests pass today."
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
