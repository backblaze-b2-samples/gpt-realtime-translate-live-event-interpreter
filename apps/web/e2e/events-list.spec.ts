import { expect, test } from "@playwright/test";

/**
 * Events grid renders the empty-state when the bucket has no `events/`
 * prefixes.
 *
 * PENDING: now that the live-translation backend is wired (commit
 * fd4d083), real runs archive events under `events/` and the connected
 * bucket is no longer empty, so the empty-state assumption no longer
 * holds. Skipped until reworked to assert against a seeded fixture (or to
 * accept either the empty state or rendered event cards) rather than
 * depending on bucket contents.
 */
test.skip("events list renders empty state for an empty bucket", async ({ page }) => {
  await page.goto("/events");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // EmptyState surfaces the headline copy in the EventsView.
  await expect(page.getByText(/no events yet/i)).toBeVisible();
});
