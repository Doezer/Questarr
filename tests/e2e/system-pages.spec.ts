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
    await page.getByRole("button", { name: "Back up now" }).click();
    const list = page.getByRole("list", { name: "Saved backups" });
    await expect(list.getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole("button", { name: /^Download backup/ }).first()).toBeVisible();
    await expect(list.getByRole("button", { name: /^Restore backup/ }).first()).toBeVisible();

    await page.getByLabel("Include journal screenshots").click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await page.reload();
    await expect(page.getByLabel("Include journal screenshots")).toBeChecked();
    await page.getByLabel("Include journal screenshots").click();
    await page.getByRole("button", { name: "Save schedule" }).click();

    const before = await list.getByRole("listitem").count();
    await list
      .getByRole("button", { name: /^Delete backup/ })
      .first()
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /delete/i })
      .click();
    if (before > 1) await expect(list.getByRole("listitem")).toHaveCount(before - 1);
    else await expect(page.getByText("No backup yet")).toBeVisible();
  });
});
