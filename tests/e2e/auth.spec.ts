import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
    // This test runs as part of the 'e2e' project which depends on 'setup'.
    // It inherits the storage state (authenticated as admin).

    test('should allow logout and login', async ({ page }) => {
        await page.goto('/');

        // Verify we are logged in
        await expect(page.locator('header')).toBeVisible();

        // Logout
        await page.getByText('Logged in').click();
        await expect(page).toHaveURL('/login');

        // Log back in
        await page.fill('input[name="username"]', 'admin');
        await page.fill('input[name="password"]', 'password123');
        await page.click('button[type="submit"]');

        await expect(page).toHaveURL('/');
    });
});
