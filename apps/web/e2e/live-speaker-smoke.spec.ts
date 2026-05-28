import { expect, test } from "@playwright/test";

/**
 * Speaker console renders. When this scaffold's UI is wired, this test will
 * also assert microphone permission UI + inline ErrorState handling when
 * `OPENAI_API_KEY` is unset.
 */
test("speaker console renders the scaffold placeholder", async ({ page }) => {
  await page.goto("/live");
  await expect(page.getByRole("heading", { name: "Speaker console" })).toBeVisible();
  await expect(page.getByText(/live interpretation/i)).toBeVisible();
});
