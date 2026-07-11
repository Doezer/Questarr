/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import ImportSettings from "../src/components/ImportSettings";
import type { ImportConfig } from "@shared/schema";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiRequest: vi.fn(async () => ({ json: async () => ({}) })),
  };
});

const baseConfig: ImportConfig = {
  enablePostProcessing: true,
  autoUnpack: true,
  overwriteExisting: false,
  libraryRoot: "/data/library",
  transferMode: "hardlink",
  autoDeleteAfterImport: false,
  importPlatformIds: [],
  renamePattern: "{Title} ({Year})",
} as unknown as ImportConfig;

function createJsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

function mockFetch({
  config = baseConfig,
  platforms = [
    { id: 1, name: "PC (Microsoft Windows)" },
    { id: 2, name: "PlayStation 5" },
  ],
  appConfig = { igdb: { configured: true } },
  hardlink = {
    generic: { targetRoot: "/data/library", supportedForAll: true, checkedSources: [] },
  },
}: {
  config?: ImportConfig | undefined;
  platforms?: unknown[];
  appConfig?: unknown;
  hardlink?: unknown;
} = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/imports/config")) return createJsonResponse(config);
    if (u.includes("/api/igdb/platforms")) return createJsonResponse(platforms);
    if (u.includes("/api/imports/hardlink/check")) return createJsonResponse(hardlink);
    if (u.includes("/api/config")) return createJsonResponse(appConfig);
    return createJsonResponse({});
  });
}

function renderComponent() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ImportSettings />
    </QueryClientProvider>
  );
}

describe("ImportSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the general config tab with loaded settings", async () => {
    renderComponent();
    expect(await screen.findByText("Enable Post-Processing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/data/library")).toBeInTheDocument();
    expect(screen.getByText("Hardlink supported.")).toBeInTheDocument();
  });

  it("toggles auto-unpack and saves changes via the mutation", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();
    await screen.findByText("Enable Post-Processing");

    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/imports/config",
        expect.objectContaining({ autoUnpack: false })
      );
    });
  });

  it("filters platforms by search text", async () => {
    renderComponent();
    await screen.findByText("PC (Microsoft Windows)");

    fireEvent.change(screen.getByPlaceholderText("Search platforms..."), {
      target: { value: "playstation" },
    });

    expect(screen.queryByText("PC (Microsoft Windows)")).not.toBeInTheDocument();
    expect(screen.getByText("PlayStation 5")).toBeInTheDocument();
  });

  it("shows a no-match message when the search filters out all platforms", async () => {
    renderComponent();
    await screen.findByText("PC (Microsoft Windows)");

    fireEvent.change(screen.getByPlaceholderText("Search platforms..."), {
      target: { value: "nonexistent-platform" },
    });

    expect(screen.getByText("No platforms match your search.")).toBeInTheDocument();
  });

  it("toggles a platform filter checkbox", async () => {
    renderComponent();
    await screen.findByText("PC (Microsoft Windows)");

    const checkbox = screen.getByLabelText("PC (Microsoft Windows)");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("shows an error state and retry button when platforms fail to load", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const u = getRequestUrl(url);
      if (u.includes("/api/igdb/platforms")) {
        return { ok: false, json: async () => ({}) } as Response;
      }
      if (u.includes("/api/imports/config")) return createJsonResponse(baseConfig);
      if (u.includes("/api/imports/hardlink/check")) {
        return createJsonResponse({
          generic: { targetRoot: "/data/library", supportedForAll: true, checkedSources: [] },
        });
      }
      return createJsonResponse({});
    });

    renderComponent();
    expect(await screen.findByText("Could not load platform list from IGDB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows an IGDB-not-configured message when there are no platforms and IGDB is unconfigured", async () => {
    mockFetch({ platforms: [], appConfig: { igdb: { configured: false } } });
    renderComponent();
    expect(
      await screen.findByText("IGDB is not configured yet — platform filters unavailable.")
    ).toBeInTheDocument();
  });

  it("switches to the help tab and renders guidance content", async () => {
    renderComponent();
    await screen.findByText("Enable Post-Processing");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Help" }));
    expect(await screen.findByText("How the import pipeline works")).toBeInTheDocument();
    expect(screen.getByText("Transfer modes")).toBeInTheDocument();
  });

  it("switches to the path mappings tab", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const u = getRequestUrl(url);
      if (u.includes("/api/imports/mappings/paths")) return createJsonResponse([]);
      if (u.includes("/api/downloaders")) return createJsonResponse([]);
      if (u.includes("/api/imports/config")) return createJsonResponse(baseConfig);
      if (u.includes("/api/igdb/platforms")) return createJsonResponse([]);
      if (u.includes("/api/imports/hardlink/check")) {
        return createJsonResponse({
          generic: { targetRoot: "/data/library", supportedForAll: true, checkedSources: [] },
        });
      }
      return createJsonResponse({});
    });

    renderComponent();
    await screen.findByText("Enable Post-Processing");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Path Mappings" }));
    expect(await screen.findByText("No mappings defined")).toBeInTheDocument();
  });

  it("shows an amber warning when hardlink is not supported for all sources", async () => {
    mockFetch({
      hardlink: {
        generic: { targetRoot: "/data/library", supportedForAll: false, checkedSources: [] },
      },
    });
    renderComponent();
    expect(
      await screen.findByText("Hardlink not available on this setup — will fall back to copy.")
    ).toBeInTheDocument();
  });

  it("shows an informational message when hardlink support is unknown", async () => {
    mockFetch({
      hardlink: {
        generic: { targetRoot: "/data/library", supportedForAll: null, checkedSources: [] },
      },
    });
    renderComponent();
    expect(
      await screen.findByText(
        "Hardlink check unavailable: configure at least one downloader path first."
      )
    ).toBeInTheDocument();
  });

  it("disables inner controls visually when post-processing is turned off", async () => {
    mockFetch({ config: { ...baseConfig, enablePostProcessing: false } });
    const { container } = renderComponent();
    await screen.findByText("Enable Post-Processing");
    expect(
      screen.queryByText(/If your download client runs on a different machine/)
    ).not.toBeInTheDocument();
    expect(container.querySelector(".pointer-events-none")).toBeInTheDocument();
  });
});
