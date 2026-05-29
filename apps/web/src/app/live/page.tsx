"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Copy, Radio, Square, Users } from "lucide-react";
import { toast } from "sonner";

import { CaptionStream } from "@/components/live/caption-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useLiveDefaults } from "@/lib/queries";
import { useSpeakerSession } from "@/lib/realtime";
import type { LiveDefaults } from "@gpt-realtime-translate-live-event-interpreter/shared";

export interface SpeakerFormValues {
  title: string;
  sourceLanguage: string;
  targetLanguages: string[];
  persistTranslatedAudio: boolean;
}

function makeEventId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const rand = Math.random().toString(36).slice(2, 8);
  const base = (slug ? `${slug}-${rand}` : `live-${rand}`).replace(/[^A-Za-z0-9_-]/g, "");
  return base.slice(0, 64).padEnd(6, "0");
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Config form. State initializes from `defaults` props (mounted once defaults
 *  load), so there's no setState-in-effect seeding. */
function SpeakerForm({
  defaults,
  onGoLive,
}: {
  defaults: LiveDefaults;
  onGoLive: (values: SpeakerFormValues) => void;
}) {
  const [title, setTitle] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState(defaults.default_source_language);
  const [targets, setTargets] = useState<Set<string>>(new Set(defaults.default_target_languages));
  const [persist, setPersist] = useState(defaults.persist_translated_audio_default);

  // Source options reuse the deployment's configured languages: the default
  // source plus every default target, deduped (source first).
  const sourceOptions = useMemo(
    () => [...new Set([defaults.default_source_language, ...defaults.default_target_languages])],
    [defaults],
  );

  const toggleTarget = (lang: string) => {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  };

  const submit = () => {
    if (targets.size === 0) {
      toast.error("Pick at least one target language");
      return;
    }
    onGoLive({
      title: title.trim(),
      sourceLanguage: sourceLanguage || "en",
      targetLanguages: [...targets],
      persistTranslatedAudio: persist,
    });
  };

  return (
    <Card className="animate-fade-in-up stagger-2">
      <CardContent className="space-y-5 p-5">
        <div className="space-y-2">
          <Label htmlFor="title">Event title</Label>
          <Input
            id="title"
            placeholder="Q3 All-Hands"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="source">Source language</Label>
          <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
            <SelectTrigger id="source" className="w-44 font-mono">
              <SelectValue placeholder="Pick a language" />
            </SelectTrigger>
            <SelectContent>
              {sourceOptions.map((lang) => (
                <SelectItem key={lang} value={lang} className="font-mono">
                  {lang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Target languages</Label>
          <div className="flex flex-wrap gap-3">
            {defaults.default_target_languages.map((lang) => (
              <label
                key={lang}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <Checkbox checked={targets.has(lang)} onCheckedChange={() => toggleTarget(lang)} />
                <span className="font-mono">{lang}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Persist translated audio</p>
            <p className="text-xs text-muted-foreground">
              Archive each language&apos;s translated audio to B2 for replay.
            </p>
          </div>
          <Switch checked={persist} onCheckedChange={setPersist} />
        </div>

        <Button onClick={submit} className="w-full sm:w-auto">
          <Radio className="h-4 w-4" />
          Go live
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LivePage() {
  const { data: defaults, isLoading } = useLiveDefaults();
  const session = useSpeakerSession();

  const [liveEventId, setLiveEventId] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("en");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (session.status !== "live") return;
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [session.status]);

  const isLive = session.status === "live" || session.status === "connecting";
  const labelFor = useMemo(
    () => (key: string) => (key === "source" ? `${sourceLabel.toUpperCase()}·SRC` : key.toUpperCase()),
    [sourceLabel],
  );

  const handleGoLive = async (values: SpeakerFormValues) => {
    const eventId = makeEventId(values.title || "live event");
    setLiveEventId(eventId);
    setSourceLabel(values.sourceLanguage);
    setElapsed(0);
    await session.start({
      eventId,
      title: values.title || eventId,
      sourceLanguage: values.sourceLanguage,
      targetLanguages: values.targetLanguages,
      persistTranslatedAudio: values.persistTranslatedAudio,
    });
  };

  const listenUrl =
    liveEventId && typeof window !== "undefined"
      ? `${window.location.origin}/live/${liveEventId}/listen`
      : "";

  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Speaker console</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Configure source + target languages, then go live. Source audio and
          per-language transcripts archive to B2 as the event runs.
        </p>
      </div>

      {session.status === "error" && session.error ? (
        <div className="animate-fade-in rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {session.error}
        </div>
      ) : null}

      {!isLive ? (
        isLoading || !defaults ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <SpeakerForm defaults={defaults} onGoLive={handleGoLive} />
        )
      ) : (
        <div className="animate-fade-in-up space-y-5">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <Badge variant={session.status === "live" ? "default" : "secondary"}>
                  {session.status === "live" ? "● LIVE" : "Connecting…"}
                </Badge>
                <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsed)}</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {session.attendees}
                </span>
              </div>
              <Button variant="destructive" size="sm" onClick={session.stop}>
                <Square className="h-3.5 w-3.5" />
                End event
              </Button>
            </CardContent>
          </Card>

          {listenUrl ? (
            <Card>
              <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
                <span className="text-muted-foreground">Attendee link:</span>
                <code className="truncate font-mono text-xs">{listenUrl}</code>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    void navigator.clipboard.writeText(listenUrl);
                    toast.success("Listen link copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/live/${liveEventId}/listen`} target="_blank">
                    Open
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <CaptionStream
            committed={session.committed}
            interim={session.interim}
            labelFor={labelFor}
            emptyHint="Start speaking — captions for the source and each target language will stream here."
          />
        </div>
      )}
    </div>
  );
}
