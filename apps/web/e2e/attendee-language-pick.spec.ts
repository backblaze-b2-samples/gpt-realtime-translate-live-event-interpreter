import { expect, test } from "@playwright/test";

/**
 * Attendee listen page renders. For an unknown event id the page falls back to
 * the "Attendee — listen" heading and an Event-not-found state; the back link
 * is always present.
 */
test("attendee listen page renders", async ({ page }) => {
  await page.goto("/live/test-event-id/listen");
  await expect(page.getByRole("heading", { name: "Attendee — listen" })).toBeVisible();
  await expect(page.getByRole("link", { name: /all events/i })).toBeVisible();
});
