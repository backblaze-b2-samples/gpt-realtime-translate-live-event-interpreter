"use client";

import { BookOpen } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlossaries } from "@/lib/queries";

export default function GlossaryPage() {
  const { data, isLoading, error, refetch } = useGlossaries();

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Glossaries</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Reusable term lists that enforce domain-specific translations.
          Attach one at event creation; the Realtime session uses it as a
          prompt-side constraint.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full animate-fade-in-up stagger-2" />
      ) : error ? (
        <Card className="animate-fade-in-up stagger-2">
          <CardContent className="p-0">
            <ErrorState error={error} onRetry={() => refetch()} />
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <Card className="animate-fade-in-up stagger-2">
          <CardContent className="p-0">
            <EmptyState
              icon={BookOpen}
              title="No glossaries yet"
              description={
                "Glossary management UI lands in a follow-up exec plan. " +
                "The backend already supports list / get / upsert / delete " +
                "against the glossaries/ prefix in B2 — POST /glossaries " +
                "with a JSON body to create one programmatically."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 animate-fade-in-up stagger-2">
          {data.map((g) => (
            <li key={g.id}>
              <Card>
                <CardContent className="space-y-1 p-4">
                  <p className="text-sm font-semibold">{g.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{g.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.terms.length} term{g.terms.length === 1 ? "" : "s"} · source{" "}
                    {g.source_language}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
