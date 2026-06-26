import { useCallback, useRef, useState } from "react";

import { MAX_INTERIM_CAPTION_BYTES } from "@/lib/realtime-constants";

const SOURCE_KEY = "source";

const langKey = (lang: string | null | undefined) => lang ?? SOURCE_KEY;

export interface CaptionLine {
  id: string;
  lang: string;
  text: string;
}

export type CaptionApplyFailureReason = "caption-buffer-overflow";

export type CaptionApplyResult =
  | { ok: true }
  | { ok: false; reason: CaptionApplyFailureReason };

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

export function useCaptions() {
  const [committed, setCommitted] = useState<CaptionLine[]>([]);
  const [interim, setInterim] = useState<Record<string, string>>({});
  const interimBytes = useRef<Record<string, number>>({});

  const apply = useCallback(
    (
      lang: string | null | undefined,
      payload: string,
      isFinal: boolean,
    ): CaptionApplyResult => {
      const key = langKey(lang);
      if (isFinal) {
        const text = payload.trim();
        interimBytes.current[key] = 0;
        setInterim((prev) => ({ ...prev, [key]: "" }));
        if (text) {
          setCommitted((prev) => [
            ...prev.slice(-99),
            { id: crypto.randomUUID(), lang: key, text },
          ]);
        }
        return { ok: true };
      } else {
        const nextBytes = (interimBytes.current[key] ?? 0) + utf8ByteLength(payload);
        if (nextBytes > MAX_INTERIM_CAPTION_BYTES) {
          return { ok: false, reason: "caption-buffer-overflow" };
        }
        interimBytes.current[key] = nextBytes;
        setInterim((prev) => ({ ...prev, [key]: (prev[key] ?? "") + payload }));
        return { ok: true };
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setCommitted([]);
    setInterim({});
    interimBytes.current = {};
  }, []);

  return { committed, interim, apply, reset };
}
