import { expect, type Page } from "@playwright/test";

import {
  INVALID_SERVER_FRAME_CLOSE_CODE,
  INVALID_SERVER_FRAME_CLOSE_REASON_PREFIX,
  INVALID_SERVER_MESSAGE,
} from "../src/lib/realtime-constants";

export { INVALID_SERVER_MESSAGE };

export type MockMessage =
  | { kind: "arrayBuffer" }
  | { kind: "text"; data: string };

type CloseCall = { code?: number; reason?: string };

type RealtimeMockOptions = {
  mediaDelaysMs?: number[];
  resumeDelaysMs?: number[];
};

export function invalidCloseReason(reason: string): string {
  return `${INVALID_SERVER_FRAME_CLOSE_REASON_PREFIX}${reason}`;
}

export async function installRealtimeMocks(
  page: Page,
  messages: MockMessage[],
  options: RealtimeMockOptions = {},
) {
  await page.addInitScript(({ mockMessages, mockOptions }) => {
    const state = window as typeof window & {
      __audioBufferCreateCount: number;
      __audioCloseCount: number;
      __audioResumeDelaysMs: number[];
      __audioSourceStartCount: number;
      __mediaDelaysMs: number[];
      __mediaStopCount: number;
      __wsCloseCalls: CloseCall[];
      __wsSendCalls: Array<{ data: unknown; url: string }>;
      __wsUrls: string[];
    };
    state.__audioBufferCreateCount = 0;
    state.__audioCloseCount = 0;
    state.__audioResumeDelaysMs = [...(mockOptions.resumeDelaysMs ?? [])];
    state.__audioSourceStartCount = 0;
    state.__mediaDelaysMs = [...(mockOptions.mediaDelaysMs ?? [])];
    state.__mediaStopCount = 0;
    state.__wsCloseCalls = [];
    state.__wsSendCalls = [];
    state.__wsUrls = [];

    const delay = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    class MockAudioContext {
      currentTime = 0;
      state = "running";
      sampleRate: number;
      destination = {};

      constructor(opts?: { sampleRate?: number }) {
        this.sampleRate = opts?.sampleRate ?? 24_000;
      }

      resume() {
        const ms = state.__audioResumeDelaysMs.shift() ?? 0;
        return delay(ms).then(() => {
          this.state = "running";
        });
      }

      close() {
        this.state = "closed";
        state.__audioCloseCount += 1;
        return Promise.resolve();
      }

      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }

      createScriptProcessor() {
        return { connect() {}, disconnect() {}, onaudioprocess: null };
      }

      createGain() {
        return { connect() {}, disconnect() {}, gain: { value: 1 } };
      }

      createBuffer(_channels: number, length: number, sampleRate: number) {
        state.__audioBufferCreateCount += 1;
        return {
          copyToChannel() {},
          duration: length / sampleRate,
        };
      }

      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start() {
            state.__audioSourceStartCount += 1;
          },
        };
      }
    }

    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      binaryType = "blob";
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      readyState = MockWebSocket.CONNECTING;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        state.__wsUrls.push(url);
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event("open"));
          mockMessages.forEach((message, index) => {
            window.setTimeout(() => {
              if (this.readyState !== MockWebSocket.OPEN) return;
              const data =
                message.kind === "arrayBuffer"
                  ? new ArrayBuffer(8)
                  : message.data;
              this.onmessage?.(new MessageEvent("message", { data }));
            }, index);
          });
        }, 0);
      }

      close(code?: number, reason?: string) {
        if (
          code !== undefined &&
          code !== 1000 &&
          (code < 3000 || code > 4999)
        ) {
          throw new DOMException("Invalid close code", "InvalidAccessError");
        }
        state.__wsCloseCalls.push({ code, reason });
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(
          new CloseEvent("close", { code: code ?? 1000, reason: reason ?? "" }),
        );
      }

      send(data: unknown) {
        state.__wsSendCalls.push({ data, url: this.url });
      }
    }

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(window, "webkitAudioContext", {
      configurable: true,
      value: MockAudioContext,
    });
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          await delay(state.__mediaDelaysMs.shift() ?? 0);
          return {
            getTracks: () => [
              {
                stop() {
                  state.__mediaStopCount += 1;
                },
              },
            ],
          };
        },
      },
    });
  }, { mockMessages: messages, mockOptions: options });
}

export async function mockLiveDefaults(page: Page) {
  await page.route("**/config/defaults", async (route) => {
    await route.fulfill({
      json: {
        default_source_language: "en",
        default_target_languages: ["es"],
        persist_translated_audio_default: true,
      },
    });
  });
}

export async function mockEvent(page: Page) {
  await page.route("**/events/test-event-id", async (route) => {
    await route.fulfill({
      json: {
        id: "test-event-id",
        title: "Test event",
        status: "live",
        source_language: "en",
        target_languages: ["es"],
        persist_translated_audio: true,
        glossary_id: null,
        created_at: "2026-06-25T00:00:00Z",
        started_at: "2026-06-25T00:00:00Z",
        ended_at: null,
        duration_ms: null,
        attendee_peak: 0,
        artifacts: [],
      },
    });
  });
}

export async function getCloseCalls(page: Page): Promise<CloseCall[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __wsCloseCalls: CloseCall[];
        }
      ).__wsCloseCalls,
  );
}

export async function getAudioStats(page: Page) {
  return page.evaluate(() => {
    const state = window as typeof window & {
      __audioBufferCreateCount: number;
      __audioCloseCount: number;
      __audioSourceStartCount: number;
    };
    return {
      bufferCreateCount: state.__audioBufferCreateCount,
      closeCount: state.__audioCloseCount,
      sourceStartCount: state.__audioSourceStartCount,
    };
  });
}

export async function getRealtimeMockStats(page: Page) {
  return page.evaluate(() => {
    const state = window as typeof window & {
      __audioCloseCount: number;
      __mediaStopCount: number;
      __wsCloseCalls: CloseCall[];
      __wsSendCalls: Array<{ data: unknown; url: string }>;
      __wsUrls: string[];
    };
    const appWsUrls = state.__wsUrls.filter(
      (url) => !url.includes("/_next/webpack-hmr"),
    );
    return {
      audioCloseCount: state.__audioCloseCount,
      mediaStopCount: state.__mediaStopCount,
      wsCloseCalls: state.__wsCloseCalls,
      wsSendCalls: state.__wsSendCalls.filter((call) =>
        appWsUrls.includes(call.url),
      ),
      wsUrls: appWsUrls,
    };
  });
}

export async function expectInvalidServerError(page: Page, reason: string) {
  await expect(page.getByText(INVALID_SERVER_MESSAGE)).toBeVisible();
  const closeCalls = await getCloseCalls(page);
  expect(closeCalls.at(-1)).toEqual({
    code: INVALID_SERVER_FRAME_CLOSE_CODE,
    reason: invalidCloseReason(reason),
  });
}
