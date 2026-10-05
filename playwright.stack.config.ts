import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { QUESTARR_PORT } from "./tests/stack/services";

// Real-stack journey: the production build of Questarr against real qBittorrent,
// Transmission and SABnzbd daemons plus a fake Torznab/Newznab indexer (tests/stack/).
// Needs `npm run build` first and the three clients installed (see .github/workflows/stack.yml).
const dataDir = process.env.QUESTARR_STACK_DATA ?? path.join(os.tmpdir(), "questarr-stack-data");

export default defineConfig({
  testDir: "./tests/stack",
  globalSetup: "./tests/stack/global-setup.ts",
  // The journeys share one server, one database and one set of clients, in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 6 * 60 * 1000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${QUESTARR_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `rm -rf "${dataDir}" && mkdir -p "${dataDir}" && node dist/server/index.js`,
    url: `http://127.0.0.1:${QUESTARR_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60 * 1000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      // Debug logs land in server.log, which the CI job uploads when a journey fails.
      LOG_LEVEL: "debug",
      PORT: String(QUESTARR_PORT),
      HOST: "127.0.0.1",
      SQLITE_DB_PATH: path.join(dataDir, "questarr.db"),
      ALLOWED_ORIGINS: `http://127.0.0.1:${QUESTARR_PORT}`,
    },
  },
});
