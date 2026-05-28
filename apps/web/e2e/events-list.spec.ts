import { expect, test } from "@playwright/test";

/**
 * Events grid renders the empty-state when the bucket has no `events/`
 * prefixes. When this scaffold's backend is fully wired, this test will
 * also assert that a seeded `event.json` shows up as a card.
 */
test("events list renders empty state for an empty bucket", async ({ page }) => {
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // EmptyState surfaces the headline copy in the EventsView.
  await expect(page.getByText(/no events yet/i)).toBeVisible();
});
