import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:5100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\.spec\.ts/,
    },
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /setup\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        storageState: "playwright/.auth/user.json",
      },
    },
  ],
});
