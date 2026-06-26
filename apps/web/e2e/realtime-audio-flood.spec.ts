import { expect, test } from "@playwright/test";

import {
  expectInvalidServerError,
  getAudioStats,
  installRealtimeMocks,
  mockEvent,
  type MockMessage,
} from "./realtime-mocks";

test("attendee audio flood is bounded before unbounded scheduling", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const payload = Buffer.alloc(96_000).toString("base64");
  const audioFrame = JSON.stringify({ type: "audio", lang: "es", payload });
  const messages: MockMessage[] = Array.from({ length: 20 }, () => ({
    kind: "text",
    data: audioFrame,
  }));
  await installRealtimeMocks(page, messages);
  await mockEvent(page);

  await page.goto("/live/test-event-id/listen");
  await page.getByRole("button", { name: /join & listen/i }).click();

  await expectInvalidServerError(page, "audio-buffer-overflow");
  await expect.poll(() => getAudioStats(page)).toMatchObject({
    bufferCreateCount: 5,
    closeCount: 1,
    sourceStartCount: 5,
  });
  expect(pageErrors).toEqual([]);
});
