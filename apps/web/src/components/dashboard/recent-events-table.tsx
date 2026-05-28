"use client";

import Link from "next/link";
import { ArrowRight, CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useEvents } from "@/lib/queries";
import { formatDate, formatDuration } from "@/lib/utils";

/**
 * Recent-events table for the dashboard.
 *
 * Sources rows from `useEvents` and renders status / source language / target
 * languages / duration / date. Replaces the starter kit's audio-asset table.
 */
export function RecentEventsTable() {
  const { data: events = [], isLoading, error, refetch } = useEvents(10);

  return (
    <Card>
      <CardHeader className="border-b border-border py-4 px-5">
        <CardTitle className="card-title">Recent Events</CardTitle>
        <CardAction className="self-center">
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : events.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No events yet"
            description="Start a live event to get started."
          />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[34%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Event
                </TableHead>
                <TableHead className="w-[14%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-[22%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Languages
                </TableHead>
                <TableHead className="w-[14%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Duration
                </TableHead>
                <TableHead className="w-[16%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Date
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id} className="table-row-hover">
                  <TableCell className="font-medium">
                    <Link
                      href={`/events/${encodeURIComponent(event.id)}`}
                      className="hover:underline"
                    >
                      <div className="truncate">{event.title}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap truncate">
                    {event.source_language || "?"} →{" "}
                    {event.target_languages.join(", ") || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {event.duration_ms ? formatDuration(event.duration_ms) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDate(event.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
