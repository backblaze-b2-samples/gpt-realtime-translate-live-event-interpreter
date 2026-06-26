import { expect, test } from "@playwright/test";

import {
  MAX_WIRE_AUDIO_PCM_BYTES,
  MAX_WIRE_TEXT_PAYLOAD_BYTES,
} from "../src/lib/realtime-constants";
import {
  getAudioStats,
  getCloseCalls,
  installRealtimeMocks,
  INVALID_SERVER_MESSAGE,
  mockEvent,
  mockLiveDefaults,
} from "./realtime-mocks";

test("speaker accepts the largest valid caption frame", async ({ page }) => {
  const payload = "x".repeat(MAX_WIRE_TEXT_PAYLOAD_BYTES);
  await installRealtimeMocks(page, [
    {
      kind: "text",
      data: JSON.stringify({ type: "caption", lang: "es", payload }),
    },
    { kind: "text", data: JSON.stringify({ type: "ready" }) },
  ]);
  await mockLiveDefaults(page);

  await page.goto("/live");
  await page.getByRole("button", { name: /go live/i }).click();

  await expect(page.getByText(/LIVE/)).toBeVisible();
  await expect(page.getByText(INVALID_SERVER_MESSAGE)).toHaveCount(0);
  expect(await getCloseCalls(page)).toEqual([]);
});

test("attendee accepts the largest valid audio frame", async ({ page }) => {
  const payload = Buffer.alloc(MAX_WIRE_AUDIO_PCM_BYTES).toString("base64");
  await installRealtimeMocks(page, [
    { kind: "text", data: JSON.stringify({ type: "ready", lang: "es" }) },
    {
      kind: "text",
      data: JSON.stringify({ type: "audio", lang: "es", payload }),
    },
  ]);
  await mockEvent(page);

  await page.goto("/live/test-event-id/listen");
  await page.getByRole("button", { name: /join & listen/i }).click();

  await expect(page.getByText(/Live · ES/)).toBeVisible();
  await expect.poll(() => getAudioStats(page)).toMatchObject({
    bufferCreateCount: 1,
    sourceStartCount: 1,
  });
  expect(await getCloseCalls(page)).toEqual([]);
});
