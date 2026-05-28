"use client";

import { CalendarRange, Clock, Radio, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { useFileStats } from "@/lib/queries";
import { formatDuration } from "@/lib/utils";

export function StatsCards() {
  const { data: stats, isLoading, error, refetch } = useFileStats();

  if (error) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const cards = [
    {
      title: "Events",
      value: stats?.total_events ?? 0,
      icon: CalendarRange,
    },
    {
      title: "Interpretation Minutes",
      value: formatDuration(stats?.total_duration_ms ?? 0),
      icon: Clock,
    },
    {
      title: "Live Now",
      value: stats?.live_events ?? 0,
      icon: Radio,
    },
    {
      title: "Peak Attendees",
      value: stats?.attendee_peak ?? 0,
      icon: Users,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <Card
          key={card.title}
          className={`card-hover animate-fade-in-up stagger-${i + 1}`}
        >
          <CardHeader className="flex flex-row items-center justify-between pt-4 pb-2 px-4 space-y-0">
            <CardTitle className="text-xs font-semibold text-muted-foreground">
              {card.title}
            </CardTitle>
            <div className="stat-icon-wrap">
              <card.icon className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="pb-5 px-4">
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="stat-value">{card.value}</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
