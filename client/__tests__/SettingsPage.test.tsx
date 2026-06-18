/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../src/pages/settings";
import { createTestQueryClient } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockResolvedValue({ json: async () => ({}) }),
  queryClient: { cancelQueries: vi.fn(), invalidateQueries: vi.fn() },
  clearSearchCache: vi.fn(),
}));

vi.mock("@/components/AutoDownloadRulesSettings", () => ({
  default: () => <div data-testid="auto-download-rules" />,
}));

vi.mock("@/components/PreferredReleaseGroupsSettings", () => ({
  default: () => <div data-testid="preferred-release-groups" />,
}));

vi.mock("@/components/PasswordSettings", () => ({
  default: () => <div data-testid="password-settings" />,
}));

vi.mock("@/components/PathBrowser", () => ({
  PathBrowser: () => <div data-testid="path-browser" />,
}));

const defaultConfig = {
  igdb: {
    configured: false,
  },
};

const defaultUserSettings = {
  autoSearchEnabled: true,
  autoSearchUnreleased: false,
  autoDownloadEnabled: false,
  searchIntervalHours: 6,
  igdbRateLimitPerSecond: 3,
  notificationPreferences: null,
  downloadRules: null,
  preferredReleaseGroups: null,
  filterByPreferredGroups: false,
  preferredPlatform: "",
  xrelSceneReleases: true,
  xrelP2pReleases: false,
};

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/config")) {
        return { ok: true, json: async () => defaultConfig } as Response;
      }
      if (url.includes("/api/blacklist")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/settings")) {
        return { ok: true, json: async () => defaultUserSettings } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("renders the Settings heading", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Settings")).toBeInTheDocument();
  });
});
