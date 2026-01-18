import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Questarr/);
});

test('loads dashboard', async ({ page }) => {
  await page.goto('/');

  // Wait for the main content to be visible
  await expect(page.locator('body')).toBeVisible();
});
