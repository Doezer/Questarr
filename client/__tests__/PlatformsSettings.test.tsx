/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PlatformsSettings from "@/components/PlatformsSettings";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const apiRequestMock = vi.fn(async () => ({ json: async () => ({}) }));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

const IGDB_PLATFORMS = [
  { id: 130, name: "Nintendo Switch" },
  { id: 6, name: "PC (Microsoft Windows)" },
  { id: 167, name: "PlayStation 5" },
];

function mockFetch({
  importPlatformIds = [] as unknown,
  platforms = IGDB_PLATFORMS,
}: { importPlatformIds?: unknown; platforms?: unknown } = {}) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/settings")) {
      return { ok: true, json: async () => ({ importPlatformIds }) } as Response;
    }
    if (u.includes("/api/igdb/platforms")) {
      return { ok: true, json: async () => platforms } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

function renderSection() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PlatformsSettings />
    </QueryClientProvider>
  );
}

describe("PlatformsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre-checks the platforms already saved in the setting", async () => {
    mockFetch({ importPlatformIds: [130] });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText("Nintendo Switch")).toBeChecked());
    expect(screen.getByLabelText("PC (Microsoft Windows)")).not.toBeChecked();
    expect(screen.getByLabelText("PlayStation 5")).not.toBeChecked();
  });

  it("saves the checked platforms as IGDB ids", async () => {
    mockFetch({ importPlatformIds: [] });
    renderSection();

    await screen.findByLabelText("Nintendo Switch");
    fireEvent.click(screen.getByLabelText("Nintendo Switch"));
    fireEvent.click(screen.getByLabelText("PlayStation 5"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith("PATCH", "/api/settings", {
        importPlatformIds: [130, 167],
      })
    );
  });

  it("preserves a stored id IGDB no longer reports", async () => {
    mockFetch({ importPlatformIds: [999, 130] });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText("Nintendo Switch")).toBeChecked());
    fireEvent.click(screen.getByLabelText("Nintendo Switch"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // Unchecking Switch drops 130 but the unknown 999 survives, so an upstream
    // removal can never silently widen the selection.
    await waitFor(() =>
      expect(apiRequestMock).toHaveBeenCalledWith("PATCH", "/api/settings", {
        importPlatformIds: [999],
      })
    );
  });

  it("renders when the stored selection is a malformed non-array", async () => {
    mockFetch({ importPlatformIds: 42 });
    renderSection();

    await screen.findByLabelText("Nintendo Switch");
    expect(screen.getByLabelText("Nintendo Switch")).not.toBeChecked();
  });

  it("shows an empty-state-safe list when IGDB returns a non-array", async () => {
    mockFetch({ platforms: { nope: true } });
    renderSection();

    await waitFor(() => expect(screen.queryByLabelText("Nintendo Switch")).not.toBeInTheDocument());
  });

  it("filters platforms by search text", async () => {
    mockFetch();
    renderSection();
    await screen.findByText("PC (Microsoft Windows)");

    fireEvent.change(screen.getByPlaceholderText("Search platforms..."), {
      target: { value: "playstation" },
    });

    expect(screen.queryByText("PC (Microsoft Windows)")).not.toBeInTheDocument();
    expect(screen.getByText("PlayStation 5")).toBeInTheDocument();
  });

  it("shows a no-match message when the search filters out all platforms", async () => {
    mockFetch();
    renderSection();
    await screen.findByText("PC (Microsoft Windows)");

    fireEvent.change(screen.getByPlaceholderText("Search platforms..."), {
      target: { value: "nonexistent-platform" },
    });

    expect(screen.getByText("No platforms match your search.")).toBeInTheDocument();
  });

  it("toggles a platform checkbox", async () => {
    mockFetch();
    renderSection();
    await screen.findByText("PC (Microsoft Windows)");

    const checkbox = screen.getByLabelText("PC (Microsoft Windows)");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
