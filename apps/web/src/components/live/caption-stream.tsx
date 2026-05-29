"use client";

import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import type { CaptionLine } from "@/lib/realtime";

interface CaptionStreamProps {
  committed: CaptionLine[];
  interim: Record<string, string>;
  /** Human label for a language key ("source" or a BCP-47 code). */
  labelFor: (key: string) => string;
  emptyHint?: string;
}

/**
 * Chronological caption feed: committed lines (newest at the bottom) followed
 * by the in-progress interim line per active language. Auto-scrolls to bottom.
 */
export function CaptionStream({ committed, interim, labelFor, emptyHint }: CaptionStreamProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const interimEntries = Object.entries(interim).filter(([, text]) => text.trim().length > 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [committed, interim]);

  const isEmpty = committed.length === 0 && interimEntries.length === 0;

  return (
    <div className="h-80 overflow-y-auto rounded-md border border-border bg-muted/30 p-4">
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">
          {emptyHint ?? "Captions will appear here as the speaker talks…"}
        </p>
      ) : (
        <ul className="space-y-2">
          {committed.map((line) => (
            <li key={line.id} className="flex gap-2 text-sm">
              <Badge variant="outline" className="h-5 shrink-0 font-mono text-[10px]">
                {labelFor(line.lang)}
              </Badge>
              <span>{line.text}</span>
            </li>
          ))}
          {interimEntries.map(([key, text]) => (
            <li key={`interim-${key}`} className="flex gap-2 text-sm opacity-60">
              <Badge variant="outline" className="h-5 shrink-0 font-mono text-[10px]">
                {labelFor(key)}
              </Badge>
              <span className="italic">{text}</span>
            </li>
          ))}
        </ul>
      )}
      <div ref={endRef} />
    </div>
  );
}
