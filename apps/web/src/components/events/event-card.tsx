"use client";

import Link from "next/link";
import { Languages, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { useDeleteEvent } from "@/lib/queries";
import { formatDate, formatDuration } from "@/lib/utils";
import type { Event } from "@gpt-realtime-translate-live-event-interpreter/shared";
import { useState } from "react";

interface EventCardProps {
  event: Event;
}

/**
 * The default Events primitive for the live-interpretation app.
 *
 * Renders an event with status badge, source language, target-language chips,
 * duration, attendee peak count, created-at, and open-in-detail / delete
 * actions. Replaces the starter kit's `AudioAssetCard`.
 */
export function EventCard({ event }: EventCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useDeleteEvent();

  const handleDelete = () => {
    deleteMutation.mutate(event.id, {
      onSuccess: () => {
        toast.success("Event deleted");
        setConfirmDelete(false);
      },
      onError: (err) => {
        const detail = err instanceof ApiError ? err.message : "Failed to delete";
        toast.error(detail);
      },
    });
  };

  const statusTone =
    event.status === "live"
      ? "default"
      : event.status === "scheduled"
        ? "secondary"
        : "outline";

  return (
    <>
      <Card className="card-hover">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/events/${encodeURIComponent(event.id)}`}
                className="line-clamp-2 text-sm font-medium hover:underline"
              >
                {event.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-mono">{event.id}</span>
                {" · "}
                {formatDate(event.created_at)}
                {event.duration_ms ? ` · ${formatDuration(event.duration_ms)}` : ""}
              </p>
            </div>
            <Badge variant={statusTone}>{event.status}</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Languages className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground mr-1">
              {event.source_language || "?"} →
            </span>
            {event.target_languages.length === 0 ? (
              <span className="text-muted-foreground">no targets</span>
            ) : (
              event.target_languages.map((lang) => (
                <Badge key={lang} variant="outline" className="font-mono text-[10px]">
                  {lang}
                </Badge>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/events/${encodeURIComponent(event.id)}`}>Open</Link>
            </Button>
            {event.status === "scheduled" || event.status === "live" ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/live/${encodeURIComponent(event.id)}/listen`}>
                  Listen
                </Link>
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {event.attendee_peak}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every artifact under{" "}
              <code className="font-mono">events/{event.id}/</code> from B2.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
