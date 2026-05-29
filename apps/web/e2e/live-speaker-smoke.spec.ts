import { expect, test } from "@playwright/test";

/**
 * Speaker console renders its configuration form. The form + "Go live" button
 * render without the API (the target-language list seeds from /config/defaults
 * but the controls don't block on it).
 */
test("speaker console renders the configuration form", async ({ page }) => {
  await page.goto("/live");
  await expect(page.getByRole("heading", { name: "Speaker console" })).toBeVisible();
  await expect(page.getByText(/target languages/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /go live/i })).toBeVisible();
});
