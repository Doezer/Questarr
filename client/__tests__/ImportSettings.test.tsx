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
  sortExtras: false,
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
  settings = {},
  hardlink = {
    generic: { targetRoot: "/data/library", supportedForAll: true, checkedSources: [] },
  },
}: {
  config?: ImportConfig | undefined;
  platforms?: unknown[];
  appConfig?: unknown;
  settings?: Record<string, unknown>;
  hardlink?: unknown;
} = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/imports/config")) return createJsonResponse(config);
    if (u.includes("/api/igdb/platforms")) return createJsonResponse(platforms);
    if (u.includes("/api/settings")) return createJsonResponse(settings);
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

  it("allows category subfolders to be enabled", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();
    await screen.findByText("Sort add-on files into subfolders");

    fireEvent.click(screen.getByRole("switch", { name: /sort add-on files into subfolders/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/imports/config",
        expect.objectContaining({ sortExtras: true })
      );
    });
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

  it("reports an active platform restriction instead of claiming all are eligible", async () => {
    // The helper returns every platform for an empty selection, so a summary
    // derived from label count would call this active selection unrestricted.
    mockFetch({ settings: { importPlatformIds: [2] } });
    renderComponent();

    expect(await screen.findByText("Eligible: PlayStation 5")).toBeInTheDocument();
    expect(screen.queryByText("All platforms are currently eligible.")).not.toBeInTheDocument();
  });

  it("does not list every platform as eligible when nothing is selected", async () => {
    mockFetch({ settings: { importPlatformIds: [] } });
    renderComponent();

    expect(await screen.findByText("All platforms are currently eligible.")).toBeInTheDocument();
    expect(screen.queryByText(/^Eligible: /)).not.toBeInTheDocument();
  });

  it("distinguishes an active restriction whose names are unavailable", async () => {
    // Id 999 is a valid restriction that IGDB does not report, so there is no
    // label to show — this must not read as "all platforms eligible".
    mockFetch({ settings: { importPlatformIds: [999] } });
    renderComponent();

    expect(await screen.findByText("Eligible platform names unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("All platforms are currently eligible.")).not.toBeInTheDocument();
  });
});
