import { test, expect } from "@playwright/test";
import { seedGame, uniqueId } from "./helpers";

test("personal screenshots live in Media and survive reload before deletion", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const game = await seedGame(page, { title: "A memorable adventure", igdbId: uniqueId() });
  await page.goto(`/games/${game.id}`);
  const gallery = page.getByRole("region", { name: "Your screenshots", exact: true });
  await expect(gallery.getByText("No screenshots yet.")).toBeVisible();
  await expect(page.getByLabel("Upload screenshot", { exact: true })).toHaveCount(1);

  // A real PNG upload exercises the existing authenticated storage API, not a mock.
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 960, 540);
    gradient.addColorStop(0, "#173b56");
    gradient.addColorStop(1, "#692d6b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 960, 540);
    context.fillStyle = "#ffffff";
    context.font = "bold 64px sans-serif";
    context.fillText("Quest complete!", 100, 250);
    context.font = "28px sans-serif";
    context.fillText("A moment worth keeping", 100, 310);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Upload screenshot", { exact: true }).setInputFiles({
    name: "quest-complete.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(
    gallery.getByRole("button", { name: "View screenshot 1", exact: true })
  ).toBeVisible();
  await page.reload();
  await expect(
    gallery.getByRole("button", { name: "View screenshot 1", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Game sections" }).getByRole("button", { name: /Media/ })
  ).toContainText("1");
  await gallery.scrollIntoViewIfNeeded();
  await gallery.screenshot({ path: testInfo.outputPath("personal-gallery-desktop.png") });
  await gallery.getByRole("button", { name: "View screenshot 1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Screenshot", exact: true });
  await expect(dialog.getByRole("img")).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath("personal-gallery-lightbox.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await gallery.scrollIntoViewIfNeeded();
  await gallery.screenshot({ path: testInfo.outputPath("personal-gallery-mobile.png") });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await gallery.getByRole("button", { name: "View screenshot 1", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(gallery.getByText("No screenshots yet.")).toBeVisible();
  await page.reload();
  await expect(gallery.getByText("No screenshots yet.")).toBeVisible();
});
