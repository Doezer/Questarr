import { test, expect, request as playwrightRequest } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test.describe("Integration API keys (Playnite)", () => {
  // Inherits authenticated state from 'setup' project

  test("creates a key in Settings, uses it from a cookie-less client, then revokes it", async ({
    page,
    baseURL,
  }) => {
    const id = uniqueId();
    const keyName = `E2E key ${id}`;
    const gameTitle = `Synced Game ${id}`;
    await page.goto("/");
    await seedGame(page, { title: gameTitle, igdbId: id });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Connections" }).click();
    await page.getByLabel("Name", { exact: true }).fill(keyName);
    await page.getByRole("button", { name: "Create key" }).click();

    const rawKey = await page.getByRole("textbox", { name: "New API key" }).inputValue();
    expect(rawKey).toMatch(/^qsr_/);

    // A machine client has no session cookie: the key alone must authenticate it.
    const client = await playwrightRequest.newContext({
      baseURL,
      // Not the browser's signed-in state: a bare client, like the extension.
      storageState: { cookies: [], origins: [] },
    });
    try {
      const unauthenticated = await client.get("/api/integration/ping");
      expect(unauthenticated.status()).toBe(401);

      const ping = await client.get("/api/integration/ping", {
        headers: { "X-Api-Key": rawKey },
      });
      expect(ping.status()).toBe(200);
      expect(await ping.json()).toMatchObject({ service: "questarr", usingApiKey: true });

      const sync = await client.post("/api/integration/library/sync", {
        headers: { "X-Api-Key": rawKey },
        data: {
          games: [
            { title: gameTitle, externalId: "pn-1", installed: true },
            { title: `Not In Library ${id}`, externalId: "pn-2" },
          ],
        },
      });
      expect(sync.status()).toBe(200);
      const syncBody = await sync.json();
      expect(syncBody.matched).toEqual([
        expect.objectContaining({ externalId: "pn-1", title: gameTitle, status: "wanted" }),
      ]);
      expect(syncBody.unmatched).toEqual([expect.objectContaining({ externalId: "pn-2" })]);

      // The key must not reach the rest of the API.
      const outsideIntegration = await client.get("/api/games", {
        headers: { "X-Api-Key": rawKey },
      });
      expect(outsideIntegration.status()).toBe(401);

      // Revoke from the UI; the key stops working immediately.
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: `Revoke API key ${keyName}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
      await expect(page.getByText(keyName)).toHaveCount(0);

      const afterRevoke = await client.get("/api/integration/ping", {
        headers: { "X-Api-Key": rawKey },
      });
      expect(afterRevoke.status()).toBe(401);
    } finally {
      await client.dispose();
    }
  });
});
