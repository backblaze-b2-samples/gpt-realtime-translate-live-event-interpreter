"use client";

/**
 * Client-side WebSocket + Web Audio glue for the live-interpretation surface.
 *
 * The browser talks to OUR API (which bridges to OpenAI) — never to OpenAI
 * directly, so the key stays server-side. Two hooks:
 *
 *   - `useSpeakerSession` — capture mic -> 24 kHz PCM16 -> `/events/{id}/speaker`,
 *     and render the live caption preview + attendee count streamed back.
 *   - `useListenSession`  — `/events/{id}/listen?lang=` -> play translated PCM16
 *     audio and render live captions for the chosen language.
 *
 * Audio format matches the gpt-realtime-translate I/O contract: little-endian
 * PCM16, mono, 24 kHz. We run the AudioContext at 24 kHz so the browser
 * resamples mic input for us (Chrome/Edge honor the sampleRate hint).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "@/lib/api-client";

export const REALTIME_SAMPLE_RATE = 24_000;

// --- wire frames (backend -> browser) ---

interface WireFrame {
  type: "ready" | "audio" | "caption" | "attendees" | "close";
  lang?: string | null;
  payload?: string;
  is_final?: boolean;
  count?: number;
  code?: number;
  reason?: string;
}

export interface CaptionLine {
  id: string;
  lang: string; // "source" for the original-language transcript
  text: string;
}

export type SessionStatus = "idle" | "connecting" | "live" | "ended" | "error";

const SOURCE_KEY = "source";
const langKey = (lang: string | null | undefined) => lang ?? SOURCE_KEY;

// --- audio helpers ---

/** Decode a base64 PCM16 payload into an Int16Array of samples. */
function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

/** Convert a Float32 mic frame [-1,1] into little-endian PCM16 bytes. */
function float32ToPcm16(input: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

/** Gap-free sequential player for incoming PCM16 chunks. */
class PcmPlayer {
  private ctx: AudioContext;
  private nextTime = 0;

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(b64: string): void {
    const int16 = base64ToInt16(b64);
    if (int16.length === 0) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
    const buffer = this.ctx.createBuffer(1, f32.length, this.ctx.sampleRate);
    buffer.copyToChannel(f32, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (this.nextTime < now) this.nextTime = now + 0.06; // small jitter buffer
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
  }

  close(): void {
    void this.ctx.close();
  }
}

// --- caption accumulation (shared by both hooks) ---

function useCaptions() {
  const [committed, setCommitted] = useState<CaptionLine[]>([]);
  const [interim, setInterim] = useState<Record<string, string>>({});

  const apply = useCallback((lang: string | null | undefined, payload: string, isFinal: boolean) => {
    const key = langKey(lang);
    if (isFinal) {
      const text = payload.trim();
      setInterim((prev) => ({ ...prev, [key]: "" }));
      if (text) {
        setCommitted((prev) => [
          ...prev.slice(-99),
          { id: crypto.randomUUID(), lang: key, text },
        ]);
      }
    } else {
      setInterim((prev) => ({ ...prev, [key]: (prev[key] ?? "") + payload }));
    }
  }, []);

  const reset = useCallback(() => {
    setCommitted([]);
    setInterim({});
  }, []);

  return { committed, interim, apply, reset };
}

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
        const frame: WireFrame = JSON.parse(e.data as string);
        if (frame.type === "ready") setStatus("live");
        else if (frame.type === "attendees") setAttendees(frame.count ?? 0);
        else if (frame.type === "caption") captions.apply(frame.lang, frame.payload ?? "", !!frame.is_final);
        else if (frame.type === "close") {
          setError(frame.reason ?? "Session closed by server.");
          setStatus("error");
        }
      };

      ws.onerror = () => {
        if (!refs.current.intentionalClose) {
          setError("Connection error. Is the API running?");
          setStatus("error");
        }
      };

      ws.onclose = () => {
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

  const leave = useCallback(() => {
    const r = refs.current;
    r.intentionalClose = true;
    r.player?.close();
    if (r.ws && (r.ws.readyState === WebSocket.OPEN || r.ws.readyState === WebSocket.CONNECTING)) {
      r.ws.close();
    }
    refs.current = {};
    setStatus("ended");
  }, []);

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
        const frame: WireFrame = JSON.parse(e.data as string);
        if (frame.type === "ready") setStatus("live");
        else if (frame.type === "audio") player.enqueue(frame.payload ?? "");
        else if (frame.type === "caption") captions.apply(frame.lang, frame.payload ?? "", !!frame.is_final);
        else if (frame.type === "close") {
          setError(frame.reason ?? "This stream is not available.");
          setStatus("error");
        }
      };
      ws.onerror = () => {
        if (!refs.current.intentionalClose) {
          setError("Connection error. Is the event live?");
          setStatus("error");
        }
      };
      ws.onclose = () => {
        if (!refs.current.intentionalClose) setStatus((s) => (s === "error" ? s : "ended"));
      };
    },
    [eventId, captions, leave],
  );

  useEffect(() => () => leave(), [leave]);

  return { status, error, lang, ...captions, join, leave };
}
