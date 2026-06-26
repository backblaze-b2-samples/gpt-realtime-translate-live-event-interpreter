import { expect, test } from "@playwright/test";

import { MAX_WIRE_TEXT_PAYLOAD_BYTES } from "../src/lib/realtime-constants";
import {
  expectInvalidServerError,
  installRealtimeMocks,
  mockEvent,
  mockLiveDefaults,
  type MockMessage,
} from "./realtime-mocks";

const captionPayload = "x".repeat(MAX_WIRE_TEXT_PAYLOAD_BYTES);
const captionFlood: MockMessage[] = Array.from({ length: 8 }, () => ({
  kind: "text",
  data: JSON.stringify({
    type: "caption",
    lang: "es",
    payload: captionPayload,
    is_final: false,
  }),
}));

test("speaker caption flood is bounded", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installRealtimeMocks(page, captionFlood);
  await mockLiveDefaults(page);

  await page.goto("/live");
  await page.getByRole("button", { name: /go live/i }).click();

  await expectInvalidServerError(page, "caption-buffer-overflow");
  expect(pageErrors).toEqual([]);
});

test("attendee caption flood is bounded", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installRealtimeMocks(page, captionFlood);
  await mockEvent(page);

  await page.goto("/live/test-event-id/listen");
  await page.getByRole("button", { name: /join & listen/i }).click();

  await expectInvalidServerError(page, "caption-buffer-overflow");
  expect(pageErrors).toEqual([]);
});
