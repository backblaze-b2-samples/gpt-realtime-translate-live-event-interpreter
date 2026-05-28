"use client";

import Link from "next/link";
import { CalendarRange, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EventActivityChart } from "@/components/dashboard/event-activity-chart";
import { FormatBreakdown } from "@/components/dashboard/format-breakdown";
import { RecentEventsTable } from "@/components/dashboard/recent-events-table";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { useFileStats } from "@/lib/queries";

/**
 * Dashboard body. Splits into two layouts driven by `useFileStats()`:
 *
 *  - **Empty bucket** (`total_events === 0`, not loading/erroring):
 *    a single hero card prompting the first live event.
 *  - **Populated**: the usual StatsCards + FormatBreakdown + chart/table grid.
 */
export function DashboardView() {
  const { data: stats, isLoading, error } = useFileStats();
  const isEmpty = !isLoading && !error && stats?.total_events === 0;

  if (isEmpty) {
    return (
      <Card className="animate-fade-in-up">
        <CardContent className="p-0">
          <EmptyState
            icon={CalendarRange}
            title="No events yet — start your first live event"
            description="Configure source + target languages, optionally attach a glossary, then go live. Source audio, transcripts, and per-language captions archive to B2 as the event runs."
            action={
              <Button asChild size="sm" className="h-8">
                <Link href="/live">
                  <Radio className="h-3.5 w-3.5" />
                  Start live event
                </Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <StatsCards />
      <FormatBreakdown />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="animate-fade-in-up stagger-3">
          <EventActivityChart />
        </div>
        <div className="animate-fade-in-up stagger-4">
          <RecentEventsTable />
        </div>
      </div>
    </>
  );
}
