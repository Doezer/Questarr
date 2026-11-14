import { expect, test } from "@playwright/test";

interface KeyStatus {
  apiKeyConfigured: boolean;
  source: "env" | "database" | null;
}

test("saves and removes the Steam Web API key from the settings", async ({ page }, testInfo) => {
  // The endpoint is mocked at the browser boundary so the test database keeps no key.
  let status: KeyStatus = { apiKeyConfigured: false, source: null };
  const saved: string[] = [];
  await page.route("**/api/settings/steam", async (route) => {
    if (route.request().method() === "POST") {
      const { apiKey } = route.request().postDataJSON() as { apiKey: string };
      saved.push(apiKey);
      status = apiKey
        ? { apiKeyConfigured: true, source: "database" }
        : { apiKeyConfigured: false, source: null };
    }
    await route.fulfill({ json: status });
  });

  await page.goto("/settings?tab=integrations");
  await page.getByRole("tab", { name: "Integrations", exact: true }).click();
  const card = page.locator("#steam-config");
  const input = card.getByLabel("Steam Web API key");
  const save = card.getByRole("button", { name: "Save key" });

  await expect(card.getByText("Not configured")).toBeVisible();
  await expect(save).toBeDisabled();
  await card.screenshot({ path: testInfo.outputPath("steam-key-empty.png") });

  await input.fill("0123456789ABCDEF0123456789ABCDEF");
  await save.click();
  await expect(card.getByText("Saved here")).toBeVisible();
  await expect(input).toHaveValue("");
  expect(saved).toEqual(["0123456789ABCDEF0123456789ABCDEF"]);
  await card.screenshot({ path: testInfo.outputPath("steam-key-saved.png") });

  await card.getByRole("button", { name: "Remove the saved key" }).click();
  await expect(card.getByText("Not configured")).toBeVisible();
  expect(saved.at(-1)).toBe("");

  await page.setViewportSize({ width: 390, height: 844 });
  await card.screenshot({ path: testInfo.outputPath("steam-key-mobile.png") });
});
