import { test, expect } from "@playwright/test";

test.describe("System pages (1.7.0)", () => {
  test("Diagnostics runs the setup checks and shows a summary", async ({ page }) => {
    await page.goto("/system/diagnostics");
    await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
    await page.getByRole("button", { name: /run/i }).first().click();
    await expect(page.getByTestId("setup-check-summary")).toBeVisible();
    await expect(
      page.locator('[data-testid^="setup-check-"]:not([data-testid$="summary"])').first()
    ).toBeVisible();
  });

  test("System Tasks lists the scheduled jobs", async ({ page }) => {
    await page.goto("/system/tasks");
    await expect(page.getByRole("heading", { name: "System Tasks" })).toBeVisible();
    await expect(page.locator('[data-testid^="task-row-"]').first()).toBeVisible();
  });

  test("Backups creates a backup, lists it, offers download and deletes it", async ({ page }) => {
    await page.goto("/system/backups");
    await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
    const existing = await page
      .locator('[data-testid^="backup-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    await page.getByRole("button", { name: "Back up now" }).click();
    // The new backup is the one that was not listed before: only that one is deleted below.
    await expect(async () => {
      const ids = await page
        .locator('[data-testid^="backup-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
      expect(ids.filter((id) => !existing.includes(id))).toHaveLength(1);
    }).toPass({ timeout: 30_000 });
    const newId = (
      await page
        .locator('[data-testid^="backup-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")))
    ).find((id) => !existing.includes(id))!;
    const row = page.getByTestId(newId);
    await expect(row.getByRole("button", { name: /^Download backup/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Restore backup/ })).toBeVisible();

    await page.getByLabel("Include journal screenshots").click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await page.reload();
    await expect(page.getByLabel("Include journal screenshots")).toBeChecked();
    await page.getByLabel("Include journal screenshots").click();
    await page.getByRole("button", { name: "Save schedule" }).click();

    await page
      .getByTestId(newId)
      .getByRole("button", { name: /^Delete backup/ })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /delete/i })
      .click();
    await expect(page.getByTestId(newId)).toHaveCount(0);
  });
});
