import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Live-event activity, total interpretation minutes, and recent
            archives in your Backblaze B2 bucket.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline" className="h-8">
            <Link href="/events">
              Browse events
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button asChild size="sm" className="h-8">
            <Link href="/live">
              <Radio className="h-3.5 w-3.5" />
              Start live event
            </Link>
          </Button>
        </div>
      </div>
      <DashboardView />
    </div>
  );
}
