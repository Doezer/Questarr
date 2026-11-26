import { test, expect } from "@playwright/test";
import { apiSend } from "./helpers";

test.describe("Setup wizard (1.7.0)", () => {
  // Both tests read and write the one global wizard state, so they cannot run side by side.
  test.describe.configure({ mode: "serial" });

  test.afterEach(async ({ page }) => {
    await page.goto("/");
    await apiSend(page, "PUT", "/api/system/setup-wizard", { state: "done" });
  });

  test("offers the wizard to a fresh install, walks through it and finishes", async ({ page }) => {
    await page.goto("/");
    await apiSend(page, "PUT", "/api/system/setup-wizard", { state: "pending" });
    await page.goto("/library-import");
    const prompt = page.getByRole("region", { name: "Setup wizard" });
    await expect(prompt).toContainText("Finish setting up Questarr");
    await prompt.getByRole("button", { name: "Open wizard" }).click();
    await expect(page).toHaveURL(/\/setup-wizard$/);

    await expect(page.getByRole("heading", { name: "Setup wizard" })).toBeVisible();
    await expect(page.getByTestId("wizard-progress-label")).toContainText("Step 1 of");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByTestId("wizard-progress-label")).toContainText("Step 2 of");
    await page
      .getByRole("navigation", { name: "Wizard navigation" })
      .getByRole("button", { name: "Back" })
      .click();
    await expect(page.getByTestId("wizard-progress-label")).toContainText("Step 1 of");

    // Skipping records the wizard as done and returns to the library.
    await page.getByRole("button", { name: "Skip wizard" }).click();
    await expect(page).toHaveURL(/\/$/);
    const state = await page.request.get("/api/system/setup-wizard");
    expect(await state.json()).toEqual({ state: "done" });
    await expect(page.getByRole("region", { name: "Setup wizard" })).toHaveCount(0);
  });

  test("an install that predates it can dismiss the prompt, and rerun it from Settings", async ({
    page,
  }) => {
    await page.goto("/");
    const invalid = await apiSend(page, "PUT", "/api/system/setup-wizard", { state: "maybe" });
    expect(invalid.status()).toBe(400);

    await page.goto("/settings/general");
    await page.getByRole("button", { name: "Run the setup wizard" }).click();
    await expect(page).toHaveURL(/\/setup-wizard$/);
    await expect(page.getByTestId("wizard-progress-label")).toContainText("Step 1 of");
  });
});
