import { expect, type Page, test } from "@playwright/test";

const INVALID_SERVER_MESSAGE = "Received an invalid server message.";
const INVALID_SERVER_FRAME_CLOSE_CODE = 4004;

type MockMessage =
  | { kind: "arrayBuffer" }
  | { kind: "text"; data: string };

async function installRealtimeMocks(page: Page, messages: MockMessage[]) {
  await page.addInitScript((mockMessages) => {
    const state = window as typeof window & {
      __audioCloseCount: number;
      __wsCloseCalls: Array<{ code?: number; reason?: string }>;
    };
    state.__audioCloseCount = 0;
    state.__wsCloseCalls = [];

    class MockAudioContext {
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
        return {
          copyToChannel() {},
          duration: length / sampleRate,
        };
      }

      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
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

async function mockLiveDefaults(page: Page) {
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

async function mockEvent(page: Page) {
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

async function expectInvalidServerError(page: Page) {
  await expect(page.getByText(INVALID_SERVER_MESSAGE)).toBeVisible();
  const closeCalls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __wsCloseCalls: Array<{ code?: number; reason?: string }>;
        }
      ).__wsCloseCalls,
  );
  expect(closeCalls.at(-1)?.code).toBe(INVALID_SERVER_FRAME_CLOSE_CODE);
}

const invalidSpeakerFrames: Array<{ name: string; message: MockMessage }> = [
  { name: "malformed JSON", message: { kind: "text", data: "{" } },
  { name: "non-text data", message: { kind: "arrayBuffer" } },
  {
    name: "oversized caption payload",
    message: {
      kind: "text",
      data: JSON.stringify({
        type: "caption",
        lang: "es",
        payload: "x".repeat(20_000),
      }),
    },
  },
  {
    name: "mispaired surrogate payload",
    message: {
      kind: "text",
      data: JSON.stringify({
        type: "caption",
        lang: "es",
        payload: "\uD800\u00E9".repeat(4096),
      }),
    },
  },
  {
    name: "oversized language tag",
    message: {
      kind: "text",
      data: JSON.stringify({
        type: "caption",
        lang: "x".repeat(80),
        payload: "Hola",
      }),
    },
  },
  {
    name: "oversized close reason",
    message: {
      kind: "text",
      data: JSON.stringify({
        type: "close",
        reason: "x".repeat(600),
      }),
    },
  },
];

for (const { name, message } of invalidSpeakerFrames) {
  test(`speaker session handles ${name} without throwing`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installRealtimeMocks(page, [message]);
    await mockLiveDefaults(page);

    await page.goto("/live");
    await page.getByRole("button", { name: /go live/i }).click();

    await expectInvalidServerError(page);
    expect(pageErrors).toEqual([]);
  });
}

test("speaker session ignores unknown additive frames", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installRealtimeMocks(page, [
    { kind: "text", data: JSON.stringify({ type: "heartbeat" }) },
    { kind: "text", data: JSON.stringify({ type: "ready" }) },
  ]);
  await mockLiveDefaults(page);

  await page.goto("/live");
  await page.getByRole("button", { name: /go live/i }).click();

  await expect(page.getByText(/LIVE/)).toBeVisible();
  await expect(page.getByText(INVALID_SERVER_MESSAGE)).toHaveCount(0);
  const closeCalls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __wsCloseCalls: Array<{ code?: number; reason?: string }>;
        }
      ).__wsCloseCalls,
  );
  expect(closeCalls).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("attendee invalid audio frame closes audio resources", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const oversizedAudio = Buffer.alloc(96_002).toString("base64");
  await installRealtimeMocks(page, [
    {
      kind: "text",
      data: JSON.stringify({ type: "audio", lang: "es", payload: oversizedAudio }),
    },
  ]);
  await mockEvent(page);

  await page.goto("/live/test-event-id/listen");
  await page.getByRole("button", { name: /join & listen/i }).click();

  await expectInvalidServerError(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __audioCloseCount: number }).__audioCloseCount,
      ),
    )
    .toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
