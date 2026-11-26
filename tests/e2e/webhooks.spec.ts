import { test, expect } from "@playwright/test";
import { apiSend, openSettingsSection } from "./helpers";

test.describe("Outbound webhooks (1.7.0)", () => {
  test("adds a webhook, shows its secret once and deletes it", async ({ page }) => {
    const name = `e2e-hook-${Date.now()}`;
    await page.goto("/settings/notifications");
    await openSettingsSection(page, "Notifications");
    await expect(page.getByRole("heading", { name: "Outbound Webhooks" })).toBeVisible();

    await page.getByRole("button", { name: "Add webhook" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add webhook" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("URL").fill("https://automation.example.com/hooks/questarr");
    // Saving needs at least one event.
    await expect(dialog.getByRole("button", { name: "Add webhook" })).toBeDisabled();
    await dialog.getByRole("checkbox").first().check();
    await dialog.getByRole("button", { name: "Add webhook" }).click();

    const created = page.getByRole("dialog", { name: "Webhook created" });
    await expect(created).toContainText("not shown again");
    await created
      .getByRole("button", { name: /done|close/i })
      .first()
      .click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();

    // The list API never returns the secret again.
    const list = await page.request.get("/api/webhooks");
    const listed = (await list.json()) as { subscriptions: Array<{ id: string; name: string }> };
    const body = JSON.stringify(listed);
    expect(body).toContain(name);
    expect(body).not.toMatch(/"secret":"[^"]{8,}"/);

    const mine = listed.subscriptions.find((s) => s.name === name)!;
    const removed = await apiSend(page, "DELETE", `/api/webhooks/${mine.id}`);
    expect(removed.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });
});
