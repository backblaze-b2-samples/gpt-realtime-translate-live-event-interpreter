"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "@/lib/api-client";
import { useCaptions } from "@/lib/realtime-captions";
import {
  closeInvalidServerFrame,
  INVALID_SERVER_MESSAGE,
} from "@/lib/realtime-errors";
import { PcmPlayer } from "@/lib/realtime-audio";
import { parseWireFrame } from "@/lib/realtime-frames";
import type { SessionStatus } from "@/lib/realtime-types";

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
  const attempt = useRef(0);

  const cleanupListenResources = useCallback((ws?: WebSocket) => {
    if (ws && refs.current.ws !== ws) return;
    refs.current.player?.close();
    refs.current = {};
  }, []);

  const closeCurrentListen = useCallback(() => {
    const r = refs.current;
    r.intentionalClose = true;
    if (
      r.ws &&
      (r.ws.readyState === WebSocket.OPEN ||
        r.ws.readyState === WebSocket.CONNECTING)
    ) {
      r.ws.close();
    }
    cleanupListenResources();
  }, [cleanupListenResources]);

  const leave = useCallback(() => {
    attempt.current += 1;
    closeCurrentListen();
    setStatus("ended");
  }, [closeCurrentListen]);

  const join = useCallback(
    async (targetLang: string) => {
      const thisAttempt = attempt.current + 1;
      attempt.current = thisAttempt;
      closeCurrentListen();
      setError(null);
      captions.reset();
      setLang(targetLang);
      setStatus("connecting");

      const player = new PcmPlayer();
      try {
        await player.resume(); // must run inside the click handler (autoplay policy)
      } catch {
        if (attempt.current !== thisAttempt) {
          player.close();
          return;
        }
        setError("Unable to start audio playback.");
        setStatus("error");
        player.close();
        return;
      }
      if (attempt.current !== thisAttempt) {
        player.close();
        return;
      }

      const ws = new WebSocket(
        wsUrl(`/events/${encodeURIComponent(eventId)}/listen?lang=${encodeURIComponent(targetLang)}`),
      );
      if (attempt.current !== thisAttempt) {
        player.close();
        ws.close();
        return;
      }
      refs.current = { ws, player, intentionalClose: false };

      ws.onmessage = (e) => {
        if (refs.current.ws !== ws || attempt.current !== thisAttempt) return;
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
          const captionResult = captions.apply(
            frame.lang,
            frame.payload,
            frame.is_final ?? false,
          );
          if (!captionResult.ok) {
            setError(INVALID_SERVER_MESSAGE);
            setStatus("error");
            cleanupListenResources(ws);
            closeInvalidServerFrame(ws, captionResult.reason);
          }
        } else if (frame.type === "close") {
          setError(frame.reason ?? "This stream is not available.");
          setStatus("error");
        }
      };
      ws.onerror = () => {
        if (refs.current.ws !== ws || attempt.current !== thisAttempt) return;
        if (!refs.current.intentionalClose) {
          setError("Connection error. Is the event live?");
          setStatus("error");
        }
      };
      ws.onclose = () => {
        if (refs.current.ws !== ws || attempt.current !== thisAttempt) return;
        const intentionalClose = refs.current.intentionalClose;
        cleanupListenResources(ws);
        if (!intentionalClose) setStatus((s) => (s === "error" ? s : "ended"));
      };
    },
    [eventId, captions, cleanupListenResources, closeCurrentListen],
  );

  useEffect(() => () => leave(), [leave]);

  return { status, error, lang, ...captions, join, leave };
}
