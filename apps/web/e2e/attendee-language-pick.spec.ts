import { expect, test } from "@playwright/test";

/**
 * Attendee listen page renders. When the picker UI lands, this test will
 * also assert that picking an unsupported language falls back to the source.
 */
test("attendee listen page renders the scaffold placeholder", async ({ page }) => {
  await page.goto("/live/test-event-id/listen");
  await expect(page.getByRole("heading", { name: "Attendee — listen" })).toBeVisible();
  await expect(page.getByText(/listen — coming soon/i)).toBeVisible();
});
