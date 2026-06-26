import { expect, test } from "@playwright/test";

import {
  getAudioStats,
  getRealtimeMockStats,
  installRealtimeMocks,
  mockEvent,
  mockLiveDefaults,
} from "./realtime-mocks";

test("speaker ignores a superseded delayed getUserMedia start", async ({ page }) => {
  await installRealtimeMocks(
    page,
    [{ kind: "text", data: JSON.stringify({ type: "ready" }) }],
    { mediaDelaysMs: [50, 0] },
  );
  await mockLiveDefaults(page);

  await page.goto("/live");
  await page.getByRole("button", { name: /go live/i }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect.poll(() => getRealtimeMockStats(page)).toMatchObject({
    mediaStopCount: 1,
    wsUrls: [expect.stringContaining("/speaker")],
  });
  const stats = await getRealtimeMockStats(page);
  expect(stats.wsUrls).toHaveLength(1);
});

test("listener keeps the latest join after out-of-order resume", async ({ page }) => {
  await installRealtimeMocks(
    page,
    [{ kind: "text", data: JSON.stringify({ type: "ready", lang: "es" }) }],
    { resumeDelaysMs: [50, 0] },
  );
  await mockEvent(page);

  await page.goto("/live/test-event-id/listen");
  await page
    .getByRole("button", { name: /join & listen/i })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });

  await expect(page.getByText(/Live · ES/)).toBeVisible();
  await expect.poll(() => getRealtimeMockStats(page)).toMatchObject({
    wsUrls: [expect.stringContaining("/listen?lang=es")],
  });
  await expect.poll(() => getAudioStats(page)).toMatchObject({ closeCount: 1 });
  const stats = await getRealtimeMockStats(page);
  expect(stats.wsUrls).toHaveLength(1);
});
