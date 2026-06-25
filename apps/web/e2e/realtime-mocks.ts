import { expect, type Page } from "@playwright/test";

export const INVALID_SERVER_MESSAGE = "Received an invalid server message.";
export const INVALID_SERVER_FRAME_CLOSE_CODE = 4004;

export type MockMessage =
  | { kind: "arrayBuffer" }
  | { kind: "text"; data: string };

type CloseCall = { code?: number; reason?: string };

export function invalidCloseReason(reason: string): string {
  return `invalid-server-frame:${reason}`;
}

export async function installRealtimeMocks(page: Page, messages: MockMessage[]) {
  await page.addInitScript((mockMessages) => {
    const state = window as typeof window & {
      __audioBufferCreateCount: number;
      __audioCloseCount: number;
      __audioSourceStartCount: number;
      __wsCloseCalls: CloseCall[];
    };
    state.__audioBufferCreateCount = 0;
    state.__audioCloseCount = 0;
    state.__audioSourceStartCount = 0;
    state.__wsCloseCalls = [];

    class MockAudioContext {
      currentTime = 0;
      state = "running";
      sampleRate: number;
      destination = {};

      constructor(opts?: { sampleRate?: number }) {
        this.sampleRate = opts?.sampleRate ?? 24_000;
      }

      resume() {
        this.state = "running";
        return Promise.resolve();
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

      send() {}
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
        getUserMedia: async () => ({
          getTracks: () => [{ stop() {} }],
        }),
      },
    });
  }, messages);
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

export async function expectInvalidServerError(page: Page, reason: string) {
  await expect(page.getByText(INVALID_SERVER_MESSAGE)).toBeVisible();
  const closeCalls = await getCloseCalls(page);
  expect(closeCalls.at(-1)).toEqual({
    code: INVALID_SERVER_FRAME_CLOSE_CODE,
    reason: invalidCloseReason(reason),
  });
}
