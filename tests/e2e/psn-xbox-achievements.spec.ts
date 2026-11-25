import { expect, test, type Page } from "@playwright/test";
import { openSettingsSection } from "./helpers";

interface Status {
  available: boolean;
  enabled: boolean;
  username: string | null;
  lastSyncAt: string | null;
  lastGamesSynced: number;
  lastNewUnlocks: number;
  lastError: string | null;
}

/** Mock one provider's API at the browser boundary. */
async function mockProvider(page: Page, apiPath: string, account: string, matched: number) {
  let status: Status = {
    available: false,
    enabled: false,
    username: null,
    lastSyncAt: null,
    lastGamesSynced: 0,
    lastNewUnlocks: 0,
    lastError: null,
  };
  await page.route(`**${apiPath}`, async (route) => {
    if (route.request().method() === "PUT") {
      status = { ...status, enabled: route.request().postDataJSON().enabled };
    }
    await route.fulfill({ json: status });
  });
  await page.route(`**${apiPath}/credentials`, async (route) => {
    status = { ...status, available: true, username: account };
    await route.fulfill({ json: status });
  });
  await page.route(`**${apiPath}/sync`, async (route) => {
    status = {
      ...status,
      lastSyncAt: new Date().toISOString(),
      lastGamesSynced: matched,
      lastNewUnlocks: 0,
    };
    await route.fulfill({ json: { result: { gamesSynced: matched, newUnlocks: 0 }, status } });
  });
}

const providers = [
  {
    name: "PlayStation",
    apiPath: "/api/psn-achievements",
    secretLabel: "NPSSO token",
    secret: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6",
    account: "4242424242",
    matched: 7,
    shot: "psn",
  },
  {
    name: "Xbox",
    apiPath: "/api/xbox-achievements",
    secretLabel: "OpenXBL API key",
    secret: "abcd1234-ef56-7890-abcd-ef1234567890",
    account: "MasterChief",
    matched: 5,
    shot: "xbox",
  },
];

for (const p of providers) {
  test(`saves a ${p.name} account, turns the sync on and runs it`, async ({ page }, testInfo) => {
    // The provider is mocked at the browser boundary; the server tests cover the sign-in, the
    // matching, the encrypted secret and the sync rules.
    await mockProvider(page, p.apiPath, p.account, p.matched);
    await page.goto("/settings?tab=integrations");
    await openSettingsSection(page, "Connections");
    const panel = page.getByRole("region", { name: p.name, exact: true });
    await expect(panel.getByRole("switch", { name: `Sync ${p.name}` })).toBeDisabled();
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`${p.shot}-empty.png`) });

    await panel.getByLabel(p.secretLabel).fill(p.secret);
    await panel.getByRole("button", { name: "Save account" }).click();
    await expect(panel.getByText(p.account)).toBeVisible();
    const toggle = panel.getByRole("switch", { name: `Sync ${p.name}` });
    await toggle.click();
    await expect(toggle).toBeChecked();

    await panel.getByRole("button", { name: "Sync now" }).click();
    await expect(
      panel.getByText(new RegExp(`${p.matched} games matched, no new unlocks`))
    ).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath(`${p.shot}-on.png`) });
  });
}
