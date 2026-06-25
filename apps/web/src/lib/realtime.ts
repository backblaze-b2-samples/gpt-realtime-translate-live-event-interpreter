"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "@/lib/api-client";
import { useCaptions } from "@/lib/realtime-captions";
import {
  closeInvalidServerFrame,
  INVALID_SERVER_MESSAGE,
} from "@/lib/realtime-errors";
import {
  float32ToPcm16,
  PcmPlayer,
  REALTIME_SAMPLE_RATE,
} from "@/lib/realtime-audio";
import { parseWireFrame } from "@/lib/realtime-frames";

export type { CaptionLine } from "@/lib/realtime-captions";

export type SessionStatus = "idle" | "connecting" | "live" | "ended" | "error";

// --- speaker ---

export interface SpeakerConfig {
  eventId: string;
  title: string;
  sourceLanguage: string;
  targetLanguages: string[];
  persistTranslatedAudio: boolean;
}

interface SpeakerRefs {
  ws?: WebSocket;
  ctx?: AudioContext;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  processor?: ScriptProcessorNode;
  sink?: GainNode;
  intentionalClose?: boolean;
}

export function useSpeakerSession() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attendees, setAttendees] = useState(0);
  const captions = useCaptions();
  const refs = useRef<SpeakerRefs>({});

  const teardown = useCallback(() => {
    const r = refs.current;
    r.processor?.disconnect();
    r.source?.disconnect();
    r.sink?.disconnect();
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.ctx && r.ctx.state !== "closed") void r.ctx.close();
    refs.current = {};
  }, []);

  const stop = useCallback(() => {
    const r = refs.current;
    r.intentionalClose = true;
    if (r.ws && r.ws.readyState === WebSocket.OPEN) {
      try {
        r.ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* socket already gone */
      }
      r.ws.close();
    }
    teardown();
    setAttendees(0);
    setStatus((s) => (s === "error" ? s : "ended"));
  }, [teardown]);

  const start = useCallback(
    async (cfg: SpeakerConfig) => {
      setError(null);
      captions.reset();
      setStatus("connecting");
      const previous = refs.current;
      previous.intentionalClose = true;
      if (
        previous.ws &&
        (previous.ws.readyState === WebSocket.OPEN ||
          previous.ws.readyState === WebSocket.CONNECTING)
      ) {
        try {
          previous.ws.close();
        } catch {
          /* socket already gone */
        }
      }
      teardown();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone permission denied. Allow mic access and retry.");
        setStatus("error");
        return;
      }

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
      const ws = new WebSocket(wsUrl(`/events/${encodeURIComponent(cfg.eventId)}/speaker`));
      ws.binaryType = "arraybuffer";
      refs.current = { ws, ctx, stream, intentionalClose: false };

      ws.onopen = () => {
        if (refs.current.ws !== ws) {
          stream.getTracks().forEach((t) => t.stop());
          if (ctx.state !== "closed") void ctx.close().catch(() => undefined);
          try {
            ws.close();
          } catch {
            /* socket already gone */
          }
          return;
        }
        ws.send(
          JSON.stringify({
            title: cfg.title,
            source_language: cfg.sourceLanguage,
            target_languages: cfg.targetLanguages,
            persist_translated_audio: cfg.persistTranslatedAudio,
          }),
        );
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        const sink = ctx.createGain();
        sink.gain.value = 0; // keep the node alive without echoing to speakers
        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(float32ToPcm16(e.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(sink);
        sink.connect(ctx.destination);
        Object.assign(refs.current, { source, processor, sink });
      };

      ws.onmessage = (e) => {
        if (refs.current.ws !== ws) return;
        const result = parseWireFrame(e.data);
        if (result.kind === "ignore") return;
        if (result.kind === "invalid") {
          setError(INVALID_SERVER_MESSAGE);
          setStatus("error");
          closeInvalidServerFrame(ws, result.reason);
          teardown();
          return;
        }
        const { frame } = result;

        if (frame.type === "ready") setStatus("live");
        else if (frame.type === "attendees") setAttendees(frame.count);
        else if (frame.type === "caption") {
          captions.apply(frame.lang, frame.payload, frame.is_final ?? false);
        }
        else if (frame.type === "close") {
          setError(frame.reason ?? "Session closed by server.");
          setStatus("error");
        }
      };

      ws.onerror = () => {
        if (refs.current.ws !== ws) return;
        if (!refs.current.intentionalClose) {
          setError("Connection error. Is the API running?");
          setStatus("error");
        }
      };

      ws.onclose = () => {
        if (refs.current.ws !== ws) return;
        if (!refs.current.intentionalClose) {
          setStatus((s) => (s === "error" ? s : "ended"));
        }
        teardown();
      };
    },
    [captions, teardown],
  );

  useEffect(() => () => stop(), [stop]);

  return { status, error, attendees, ...captions, start, stop };
}

// --- listener ---

interface ListenRefs {
  ws?: WebSocket;
  player?: PcmPlayer;
  intentionalClose?: boolean;
}

export function useListenSession(eventId: string) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const captions = useCaptions();
  const refs = useRef<ListenRefs>({});

  const cleanupListenResources = useCallback((ws?: WebSocket) => {
    if (ws && refs.current.ws !== ws) return;
    refs.current.player?.close();
    refs.current = {};
  }, []);

  const leave = useCallback(() => {
    const r = refs.current;
    r.intentionalClose = true;
    if (r.ws && (r.ws.readyState === WebSocket.OPEN || r.ws.readyState === WebSocket.CONNECTING)) {
      r.ws.close();
    }
    cleanupListenResources();
    setStatus("ended");
  }, [cleanupListenResources]);

  const join = useCallback(
    async (targetLang: string) => {
      leave();
      setError(null);
      captions.reset();
      setLang(targetLang);
      setStatus("connecting");

      const player = new PcmPlayer();
      await player.resume(); // must run inside the click handler (autoplay policy)
      const ws = new WebSocket(
        wsUrl(`/events/${encodeURIComponent(eventId)}/listen?lang=${encodeURIComponent(targetLang)}`),
      );
      refs.current = { ws, player, intentionalClose: false };

      ws.onmessage = (e) => {
        if (refs.current.ws !== ws) return;
        const result = parseWireFrame(e.data);
        if (result.kind === "ignore") return;
        if (result.kind === "invalid") {
          setError(INVALID_SERVER_MESSAGE);
          setStatus("error");
          cleanupListenResources(ws);
          closeInvalidServerFrame(ws, result.reason);
          return;
        }
        const { frame } = result;

        if (frame.type === "ready") setStatus("live");
        else if (frame.type === "audio") {
          try {
            const enqueueResult = player.enqueue(frame.payload);
            if (!enqueueResult.ok) {
              setError(INVALID_SERVER_MESSAGE);
              setStatus("error");
              cleanupListenResources(ws);
              closeInvalidServerFrame(ws, enqueueResult.reason);
            }
          } catch {
            setError(INVALID_SERVER_MESSAGE);
            setStatus("error");
            cleanupListenResources(ws);
            closeInvalidServerFrame(ws, "audio-playback-failed");
          }
        } else if (frame.type === "caption") {
          captions.apply(frame.lang, frame.payload, frame.is_final ?? false);
        } else if (frame.type === "close") {
          setError(frame.reason ?? "This stream is not available.");
          setStatus("error");
        }
      };
      ws.onerror = () => {
        if (refs.current.ws !== ws) return;
        if (!refs.current.intentionalClose) {
          setError("Connection error. Is the event live?");
          setStatus("error");
        }
      };
      ws.onclose = () => {
        if (refs.current.ws !== ws) return;
        const intentionalClose = refs.current.intentionalClose;
        cleanupListenResources(ws);
        if (!intentionalClose) setStatus((s) => (s === "error" ? s : "ended"));
      };
    },
    [eventId, captions, cleanupListenResources, leave],
  );

  useEffect(() => () => leave(), [leave]);

  return { status, error, lang, ...captions, join, leave };
}
