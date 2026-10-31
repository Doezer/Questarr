import { test, expect } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test("a mixed-case trailing-slash login uses the auth layout and restores encoded context", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const target = "/settings?tab=import&note=A%26B&literal=%252F#context";
    const login = `/LoGiN/?next=${encodeURIComponent(target)}`;
    await page.goto(login);
    const submit = page.getByRole("button", { name: "Login", exact: true });
    await expect(submit).toBeEnabled();
    await expect(page).toHaveURL(login);
    await expect(page.getByRole("button", { name: "Add Game", exact: true })).toHaveCount(0);
    const screenshot = testInfo.outputPath("notification-login-auth-layout.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("notification-login-auth-layout", {
      path: screenshot,
      contentType: "image/png",
    });
    await page.fill('input[name="username"]', "admin");
    await page.fill('input[name="password"]', "password123");
    await submit.click();
    await expect(page).toHaveURL(target);
    await expect(page.getByRole("tab", { name: "Import", exact: true })).toHaveAttribute(
      "data-state",
      "active"
    );
  } finally {
    await context.close();
  }
});

test("a notification opens its game page after login and a login-page reload", async ({
  page,
  browser,
}, testInfo) => {
  const game = await seedGame(page, { title: "Notification context test", igdbId: uniqueId() });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const recipient = await context.newPage();
    const target = `/games/${game.id}`;
    await recipient.goto(target);
    await expect(recipient).toHaveURL(`/login?next=${encodeURIComponent(target)}`);
    await recipient.reload();
    await recipient.fill('input[name="username"]', "admin");
    await recipient.fill('input[name="password"]', "password123");
    await recipient.getByRole("button", { name: /^(login|sign in|log in)$/i }).click();
    await expect(recipient).toHaveURL(target);
    await expect(recipient.getByText(game.title, { exact: true }).first()).toBeVisible();
    const screenshot = testInfo.outputPath("notification-game-after-login.png");
    await recipient.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("notification-game-after-login", {
      path: screenshot,
      contentType: "image/png",
    });
  } finally {
    await context.close();
  }
});

test("a settings notification retains its tab and anchor after login", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const target = "/settings?tab=notifications&note=A%26B#context";
    await page.goto(target);
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(target)}`);
    await page.fill('input[name="username"]', "admin");
    await page.fill('input[name="password"]', "password123");
    await page.getByRole("button", { name: /^(login|sign in|log in)$/i }).click();
    await expect(page).toHaveURL(target);
    await expect(page.getByRole("tab", { name: "Notifications", exact: true })).toHaveAttribute(
      "data-state",
      "active"
    );
  } finally {
    await context.close();
  }
});
