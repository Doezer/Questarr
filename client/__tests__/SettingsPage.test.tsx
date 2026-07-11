/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../src/pages/settings";
import { createTestQueryClient } from "./test-utils";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn().mockResolvedValue({
    headers: { get: () => null },
    json: async () => ({}),
  }),
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

  it("reveals interval, unreleased, and auto-download controls when auto-search is enabled", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByLabelText("Enable Auto-Search")).toBeChecked();
    expect(screen.getByLabelText("Search Interval (hours)")).toBeInTheDocument();
    expect(screen.getByLabelText("Search Unreleased Games")).toBeInTheDocument();
    expect(screen.getByLabelText("Auto-Download Single Releases")).toBeInTheDocument();
  });

  it("hides interval and downstream toggles when auto-search is disabled", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/config"))
        return { ok: true, json: async () => defaultConfig } as Response;
      if (url.includes("/api/blacklist")) return { ok: true, json: async () => [] } as Response;
      if (url.includes("/api/settings")) {
        return {
          ok: true,
          json: async () => ({ ...defaultUserSettings, autoSearchEnabled: false }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByLabelText("Enable Auto-Search");
    expect(screen.queryByLabelText("Search Interval (hours)")).not.toBeInTheDocument();
  });

  it("saves auto-search settings via the PATCH mutation", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByLabelText("Enable Auto-Search");
    fireEvent.click(screen.getByRole("button", { name: /save auto-search/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/settings",
        expect.objectContaining({ autoSearchEnabled: true })
      );
    });
  });

  it("toggling the search interval input updates its value", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    const intervalInput = await screen.findByLabelText("Search Interval (hours)");
    fireEvent.change(intervalInput, { target: { value: "24" } });
    expect(intervalInput).toHaveValue(24);
  });

  it("switches to the Rules tab and renders the mocked rule components", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rules" }));

    expect(await screen.findByTestId("auto-download-rules")).toBeInTheDocument();
    expect(screen.getByTestId("preferred-release-groups")).toBeInTheDocument();
  });

  it("switches to the Services tab and saves a Steam ID", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Services" }));

    const steamInput = await screen.findByLabelText("Steam ID (64-bit)");
    fireEvent.change(steamInput, { target: { value: "76561198000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ID" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/user/steam-id", {
        steamId: "76561198000000000",
      });
    });
  });
});
