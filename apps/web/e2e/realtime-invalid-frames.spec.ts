import { expect, test } from "@playwright/test";

import {
  expectInvalidServerError,
  getAudioStats,
  getCloseCalls,
  installRealtimeMocks,
  INVALID_SERVER_MESSAGE,
  mockEvent,
  mockLiveDefaults,
  type MockMessage,
} from "./realtime-mocks";

const invalidSpeakerFrames: Array<{
  name: string;
  message: MockMessage;
  reason: string;
}> = [
  {
    name: "malformed JSON",
    message: { kind: "text", data: "{" },
    reason: "malformed-json",
  },
  {
    name: "non-text data",
    message: { kind: "arrayBuffer" },
    reason: "non-text-data",
  },
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
    reason: "payload-too-large",
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
    reason: "payload-too-large",
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
    reason: "invalid-lang",
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
    reason: "reason-too-large",
  },
  {
    name: "non-boolean is_final",
    message: {
      kind: "text",
      data: JSON.stringify({
        type: "caption",
        lang: "es",
        payload: "done",
        is_final: "true",
      }),
    },
    reason: "invalid-is-final",
  },
];

for (const { name, message, reason } of invalidSpeakerFrames) {
  test(`speaker session handles ${name} without throwing`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installRealtimeMocks(page, [message]);
    await mockLiveDefaults(page);

    await page.goto("/live");
    await page.getByRole("button", { name: /go live/i }).click();

    await expectInvalidServerError(page, reason);
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
  expect(await getCloseCalls(page)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

const invalidAttendeeFrames: Array<{
  name: string;
  payload: string;
  reason: string;
}> = [
  {
    name: "invalid audio base64",
    payload: "not-base64",
    reason: "audio-base64-invalid",
  },
  {
    name: "oversized audio",
    payload: Buffer.alloc(96_002).toString("base64"),
    reason: "audio-too-large",
  },
];

for (const { name, payload, reason } of invalidAttendeeFrames) {
  test(`attendee ${name} closes audio resources`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installRealtimeMocks(page, [
      {
        kind: "text",
        data: JSON.stringify({ type: "audio", lang: "es", payload }),
      },
    ]);
    await mockEvent(page);

    await page.goto("/live/test-event-id/listen");
    await page.getByRole("button", { name: /join & listen/i }).click();

    await expectInvalidServerError(page, reason);
    await expect.poll(() => getAudioStats(page)).toMatchObject({ closeCount: 1 });
    expect(pageErrors).toEqual([]);
  });
}
