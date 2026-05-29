"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Headphones, Volume2 } from "lucide-react";

import { CaptionStream } from "@/components/live/caption-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvent } from "@/lib/queries";
import { useListenSession } from "@/lib/realtime";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ListenPage({ params }: PageProps) {
  const { id } = use(params);
  const { data: event, isLoading, error } = useEvent(id);
  const session = useListenSession(id);

  // `null` = "user hasn't picked"; fall back to the first target language so
  // the Select has a value without a setState-in-effect seed.
  const [picked, setPicked] = useState<string | null>(null);
  const targetLanguages = event?.target_languages ?? [];
  const selected = picked ?? targetLanguages[0] ?? "";

  const joined = session.status === "live" || session.status === "connecting";

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
        <h1 className="page-title">{event?.title ?? "Attendee — listen"}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Event <code className="font-mono text-xs">{id}</code>
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error ? (
        <ErrorState
          error={error}
          title="Event not found"
          description="This event hasn't been created yet, or has no archive. Ask the speaker for a fresh link."
        />
      ) : (
        <>
          <Card className="animate-fade-in-up stagger-2">
            <CardContent className="flex flex-wrap items-end gap-3 p-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">Language</p>
                <Select value={selected} onValueChange={setPicked} disabled={joined}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Pick a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {targetLanguages.map((lang) => (
                      <SelectItem key={lang} value={lang} className="font-mono">
                        {lang}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {joined ? (
                <Button variant="destructive" onClick={session.leave}>
                  Leave
                </Button>
              ) : (
                <Button
                  onClick={() => selected && session.join(selected)}
                  disabled={!selected}
                >
                  <Headphones className="h-4 w-4" />
                  Join &amp; listen
                </Button>
              )}

              {session.status === "live" ? (
                <Badge variant="default" className="ml-auto">
                  <Volume2 className="mr-1 h-3 w-3" />
                  Live · {session.lang?.toUpperCase()}
                </Badge>
              ) : session.status === "connecting" ? (
                <Badge variant="secondary" className="ml-auto">
                  Connecting…
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          {session.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {session.error}
            </div>
          ) : null}

          {joined ? (
            <CaptionStream
              committed={session.committed}
              interim={session.interim}
              labelFor={(key) => key.toUpperCase()}
              emptyHint="Waiting for the speaker… translated captions will appear here."
            />
          ) : (
            <EmptyState
              icon={Headphones}
              title="Pick a language and join"
              description="Translated audio plays through your speakers; captions stream below. The event must be live."
            />
          )}
        </>
      )}
    </div>
  );
}
