"use client";

import Link from "next/link";
import { CalendarRange, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvents } from "@/lib/queries";

import { EventCard } from "./event-card";

/**
 * Grid view of the live-event archive — every event under the `events/`
 * prefix. Sample-specific; the full bucket lives at `/files`.
 */
export function EventsView() {
  const { data, isLoading, isFetching, error, refetch } = useEvents();
  const events = data ?? [];

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={CalendarRange}
            title="No events yet"
            description="Start a live event to begin streaming source audio and persisting per-language artifacts to B2."
            action={
              <Button asChild size="sm">
                <Link href="/live">Start a live event</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-7 text-xs"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
