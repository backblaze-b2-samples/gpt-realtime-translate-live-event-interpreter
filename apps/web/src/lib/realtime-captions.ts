import { useCallback, useState } from "react";

const SOURCE_KEY = "source";

const langKey = (lang: string | null | undefined) => lang ?? SOURCE_KEY;

export interface CaptionLine {
  id: string;
  lang: string;
  text: string;
}

export function useCaptions() {
  const [committed, setCommitted] = useState<CaptionLine[]>([]);
  const [interim, setInterim] = useState<Record<string, string>>({});

  const apply = useCallback(
    (lang: string | null | undefined, payload: string, isFinal: boolean) => {
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
    },
    [],
  );

  const reset = useCallback(() => {
    setCommitted([]);
    setInterim({});
  }, []);

  return { committed, interim, apply, reset };
}
