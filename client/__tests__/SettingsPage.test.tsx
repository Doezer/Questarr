/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../src/pages/settings";
import { createTestQueryClient } from "./test-utils";

vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<(value: string) => void>(() => {});
  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
    }) => <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>,
    SelectTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

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

vi.mock("@/components/ReleaseScoringSettings", () => ({
  default: () => <div data-testid="release-scoring" />,
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
  hideShelvedByDefault: true,
  hideOwnedInHasResults: true,
};

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Picking a tab writes ?tab= to the URL, which would otherwise leak into the next test
    window.history.replaceState(null, "", "/");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/config")) {
        return { ok: true, json: async () => defaultConfig } as Response;
      }
      if (url.includes("/api/blacklist")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/api-keys")) {
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

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

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

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

    await screen.findByLabelText("Enable Auto-Search");
    expect(screen.queryByLabelText("Search Interval (hours)")).not.toBeInTheDocument();
  });

  it("opens the tab named by ?tab= in the URL", async () => {
    window.history.replaceState(null, "", "/?tab=discovery");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByLabelText("Enable Auto-Search");
  });

  it("renders library filtering defaults and saves them via the PATCH mutation", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");

    const hideShelvedToggle = await screen.findByLabelText("Hide shelved games by default");
    expect(hideShelvedToggle).toBeChecked();
    const hideOwnedToggle = screen.getByLabelText("Hide owned games in “Has Results” filter");
    expect(hideOwnedToggle).toBeChecked();

    fireEvent.click(hideShelvedToggle);
    fireEvent.click(screen.getByRole("button", { name: /save library filtering/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/settings",
        expect.objectContaining({ hideShelvedByDefault: false, hideOwnedInHasResults: true })
      );
    });
  });

  describe("unsaved changes", () => {
    afterEach(async () => {
      // One test leaves PATCH pending forever; give later tests the default mock back.
      const { apiRequest } = await import("@/lib/queryClient");
      vi.mocked(apiRequest).mockImplementation((async () => ({
        headers: { get: () => null },
        json: async () => ({}),
      })) as never);
    });

    const renderPage = () =>
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <SettingsPage />
        </QueryClientProvider>
      );

    it("shows no unsaved-changes bar until a card is edited", async () => {
      renderPage();
      await screen.findByLabelText("Hide shelved games by default");
      expect(screen.queryByTestId("unsaved-changes-bar")).not.toBeInTheDocument();

      fireEvent.click(screen.getByLabelText("Hide shelved games by default"));

      const bar = await screen.findByTestId("unsaved-changes-bar");
      expect(bar).toHaveTextContent("Unsaved changes in Library Filtering");
      expect(screen.getAllByText("Unsaved changes").length).toBeGreaterThan(0);
    });

    it("Discard puts the edited fields back to the saved values", async () => {
      renderPage();
      const toggle = await screen.findByLabelText("Hide shelved games by default");
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();

      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

      await waitFor(() => expect(toggle).toBeChecked());
      expect(screen.queryByTestId("unsaved-changes-bar")).not.toBeInTheDocument();
    });

    it("Save all sends the edits of every changed card in one request", async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      renderPage();
      fireEvent.click(await screen.findByLabelText("Hide shelved games by default"));
      fireEvent.click(screen.getByLabelText("Hide erotic content"));

      fireEvent.click(await screen.findByRole("button", { name: "Save all" }));

      await waitFor(() => {
        expect(apiRequest).toHaveBeenCalledWith(
          "PATCH",
          "/api/settings",
          expect.objectContaining({ hideShelvedByDefault: false, hideAdultContent: false })
        );
      });
    });

    it("only the card being saved shows Saving...", async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const respond = { headers: { get: () => null }, json: async () => ({}) };
      // Page-load GETs resolve at once; the save request stays pending.
      vi.mocked(apiRequest).mockImplementation(((method: string) =>
        method === "PATCH" ? new Promise(() => {}) : Promise.resolve(respond)) as never);
      renderPage();
      fireEvent.click(await screen.findByLabelText("Hide shelved games by default"));
      fireEvent.click(screen.getByRole("button", { name: /save library filtering/i }));

      await screen.findByRole("button", { name: /saving/i });
      expect(screen.getAllByRole("button", { name: /saving/i })).toHaveLength(1);
      expect(screen.getByRole("button", { name: /save content filtering/i })).toBeInTheDocument();
    });

    it("warns before the tab is closed only while edits are pending", async () => {
      renderPage();
      const toggle = await screen.findByLabelText("Hide shelved games by default");
      const closeTab = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(closeTab()).toBe(false);

      fireEvent.click(toggle);
      await screen.findByTestId("unsaved-changes-bar");
      expect(closeTab()).toBe(true);
    });

    it("Discard restores the saved value even when the refetch after a save fails", async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const saved = { ...defaultUserSettings, hideShelvedByDefault: false };
      const respond = { headers: { get: () => null }, json: async () => ({}) };
      vi.mocked(apiRequest).mockImplementation(((method: string) =>
        Promise.resolve(
          method === "PATCH" ? { headers: { get: () => null }, json: async () => saved } : respond
        )) as never);
      let settingsLoaded = false;
      const baseFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/settings") && !url.includes("/api/settings/")) {
          if (settingsLoaded) throw new Error("network down");
          settingsLoaded = true;
        }
        return baseFetch(input, init);
      }) as typeof fetch;
      renderPage();
      const toggle = await screen.findByLabelText("Hide shelved games by default");
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole("button", { name: /save library filtering/i }));
      // The PATCH succeeded; the refetch keeps failing (and retrying) in the background.
      await waitFor(() => expect(settingsLoaded).toBe(true));
      await waitFor(() =>
        expect(screen.queryByTestId("unsaved-changes-bar")).not.toBeInTheDocument()
      );

      fireEvent.click(toggle); // edit the saved field again...
      // Discard stays locked while the (failing) refetch is retried, then unlocks.
      const discard = await screen.findByRole("button", { name: "Discard" });
      await waitFor(() => expect(discard).toBeEnabled(), { timeout: 20000 });
      fireEvent.click(discard);

      // ...and Discard goes back to the saved value (false), not the stale cached true.
      await waitFor(() => expect(toggle).not.toBeChecked());
    }, 30000);

    it("keeps warning while a save is in flight even if the field is toggled back", async () => {
      const { apiRequest } = await import("@/lib/queryClient");
      const respond = { headers: { get: () => null }, json: async () => ({}) };
      vi.mocked(apiRequest).mockImplementation(((method: string) =>
        method === "PATCH" ? new Promise(() => {}) : Promise.resolve(respond)) as never);
      renderPage();
      const toggle = await screen.findByLabelText("Hide shelved games by default");
      fireEvent.click(toggle);
      fireEvent.click(screen.getByRole("button", { name: /save library filtering/i }));
      await screen.findByRole("button", { name: /saving/i });

      fireEvent.click(toggle); // back to the cached value: nothing dirty, but the PATCH holds false
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it("saves auto-search settings via the PATCH mutation", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

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

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

    const intervalInput = await screen.findByLabelText("Search Interval (hours)");
    fireEvent.change(intervalInput, { target: { value: "24" } });
    expect(intervalInput).toHaveValue(24);
  });

  it("switches to the Search & Downloads tab and renders the mocked rule components", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

    expect(await screen.findByTestId("auto-download-rules")).toBeInTheDocument();
  });

  it("lists release scoring on its own tab and keeps old classification links working", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Release Scoring" }));

    expect(await screen.findByTestId("release-scoring")).toBeInTheDocument();
  });

  it("opens the Release Scoring tab for a link to the classification review card", async () => {
    window.history.replaceState(null, "", "/settings?tab=discovery#classification-review");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId("release-scoring")).toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("follows a review link that only adds the hash to the current tab", async () => {
    window.history.replaceState(null, "", "/settings?tab=discovery");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );
    await screen.findByTestId("auto-download-rules");

    act(() => {
      window.history.replaceState(null, "", "/settings?tab=discovery#classification-review");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(await screen.findByTestId("release-scoring")).toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });

  it("ignores an inherited property name in the URL hash", async () => {
    window.history.replaceState(null, "", "/settings?tab=integrations#__proto__");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("tab", { name: "Connections", selected: true })).toBeVisible();
    window.history.replaceState(null, "", "/");
  });

  it("renders the platform picker in the General tab", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    expect(screen.queryByRole("tab", { name: "Platforms" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "General" }));

    expect(
      await screen.findByText("Choose the platforms you use.", { exact: false })
    ).toBeInTheDocument();
  });

  it("switches to the Integrations tab and saves a Steam ID", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Connections" }));

    const steamInput = await screen.findByLabelText("Steam ID (64-bit)");
    fireEvent.change(steamInput, { target: { value: "76561198000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save ID" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/user/steam-id", {
        steamId: "76561198000000000",
      });
    });
  });

  it("switches to the Notifications tab and toggles Apprise mode fields", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notifications" }));

    expect(await screen.findByLabelText(/API URL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Config Key/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Test Notification" })).toBeDisabled();

    fireEvent.click(screen.getByText("CLI"));

    await waitFor(() => {
      expect(screen.queryByLabelText(/API URL/)).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Config Key/)).not.toBeInTheDocument();
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it("saves Apprise settings once required fields are filled in", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notifications" }));

    const saveButton = await screen.findByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/API URL/), {
      target: { value: "http://apprise:8000" },
    });
    fireEvent.change(screen.getByLabelText(/Notification URLs/), {
      target: { value: "discord://webhook/xyz" },
    });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/settings/apprise", {
        mode: "api",
        apiUrl: "http://apprise:8000",
        key: "",
        urls: "discord://webhook/xyz",
        username: "",
        password: "",
      });
    });
  });

  it("debounces a notification preference toggle into a settings PATCH", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Notifications" }));

    const toggle = await screen.findByLabelText("In-App: Game Released");
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();

    await waitFor(
      () => {
        expect(apiRequest).toHaveBeenCalledWith(
          "PATCH",
          "/api/settings",
          expect.objectContaining({
            notificationPreferences: expect.stringContaining('"gameReleased":{"inApp":false'),
          })
        );
      },
      { timeout: 2000 }
    );
  });

  it("switches to the Search & Downloads tab, lists a blacklist entry, and removes it", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/config"))
        return { ok: true, json: async () => defaultConfig } as Response;
      if (url.includes("/api/blacklist")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "bl-1",
              gameId: "game-1",
              gameTitle: "Space Quest",
              releaseTitle: "Space.Quest-GROUP",
              indexerName: "TestIndexer",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        } as Response;
      }
      if (url.includes("/api/settings"))
        return { ok: true, json: async () => defaultUserSettings } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Search & Downloads" }));

    expect(await screen.findByText("Space Quest")).toBeInTheDocument();
    const releaseTitle = screen.getByText("Space.Quest-GROUP");
    const row = releaseTitle.closest("div.flex.items-center.justify-between") as HTMLElement;
    fireEvent.click(within(row).getByRole("button"));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/games/game-1/blacklist/bl-1");
    });
  });

  it("clamps IGDB rate limit input to minimum 1 when a lower value is entered", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Connections" }));

    const rateLimitInput = await screen.findByLabelText("IGDB API Rate Limit (requests/second)");
    fireEvent.change(rateLimitInput, { target: { value: "0" } });
    expect(rateLimitInput).toHaveValue(1);
  });

  it("clamps IGDB rate limit input to maximum 4 when a higher value is entered", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Connections" }));

    const rateLimitInput = await screen.findByLabelText("IGDB API Rate Limit (requests/second)");
    fireEvent.change(rateLimitInput, { target: { value: "5" } });
    expect(rateLimitInput).toHaveValue(4);
  });

  it("defaults IGDB rate limit to 3 when non-numeric input is entered", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Connections" }));

    const rateLimitInput = await screen.findByLabelText("IGDB API Rate Limit (requests/second)");
    fireEvent.change(rateLimitInput, { target: { value: "abc" } });
    expect(rateLimitInput).toHaveValue(3);
  });

  it("clamps an out-of-range persisted IGDB rate limit when loading settings", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/settings")) {
        return {
          ok: true,
          json: async () => ({ ...defaultUserSettings, igdbRateLimitPerSecond: 10 }),
        } as Response;
      }
      if (url.includes("/api/config")) {
        return { ok: true, json: async () => defaultConfig } as Response;
      }
      if (url.includes("/api/blacklist")) {
        return { ok: true, json: async () => [] } as Response;
      }
      if (url.includes("/api/api-keys")) {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Connections" }));

    const rateLimitInput = await screen.findByLabelText("IGDB API Rate Limit (requests/second)");
    expect(rateLimitInput).toHaveValue(4);
  });

  it("switches to the System tab and toggles downloader debug logging", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    vi.mocked(apiRequest).mockImplementation(async (method: string, url: string) => {
      if (url === "/api/downloaders/debug-logging") {
        const enabled = method === "PUT";
        return { headers: { get: () => null }, json: async () => ({ enabled }) } as Response;
      }
      return { headers: { get: () => null }, json: async () => ({}) } as Response;
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "System" }));

    const debugSwitch = await screen.findByLabelText("Log full downloader responses");
    await waitFor(() => expect(debugSwitch).not.toBeDisabled());
    expect(debugSwitch).not.toBeChecked();

    fireEvent.click(debugSwitch);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/downloaders/debug-logging", {
        enabled: true,
      });
    });
    await waitFor(() => expect(debugSwitch).toBeChecked());
  });

  it("disables downloader debug logging switch and shows an error when the setting fails to load", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    vi.mocked(apiRequest).mockImplementation(async (method: string, url: string) => {
      if (url === "/api/downloaders/debug-logging") {
        throw new Error("Failed to fetch");
      }
      return { headers: { get: () => null }, json: async () => ({}) } as Response;
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await screen.findByText("Settings");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "System" }));

    const debugSwitch = await screen.findByLabelText("Log full downloader responses");
    await waitFor(() => expect(debugSwitch).toBeDisabled());
    expect(
      await screen.findByText("Failed to load the current setting. Refresh the page to try again.")
    ).toBeInTheDocument();
  });
});
