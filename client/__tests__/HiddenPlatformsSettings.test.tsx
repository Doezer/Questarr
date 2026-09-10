/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HiddenPlatformsSettings from "../src/components/HiddenPlatformsSettings";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiRequest: vi.fn(async () => ({ json: async () => ({}) })),
  };
});

const IGDB_PLATFORMS = [
  { id: 130, name: "Nintendo Switch" },
  { id: 6, name: "PC (Microsoft Windows)" },
  { id: 167, name: "PlayStation 5" },
];

function mockFetch({ hiddenPlatforms = [] as string[], platforms = IGDB_PLATFORMS } = {}) {
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/settings")) {
      return { ok: true, json: async () => ({ hiddenPlatforms }) } as Response;
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
      <HiddenPlatformsSettings />
    </QueryClientProvider>
  );
}

describe("HiddenPlatformsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pre-checks platforms already stored as hidden", async () => {
    mockFetch({ hiddenPlatforms: ["Nintendo Switch"] });
    renderSection();

    await waitFor(() => expect(screen.getByLabelText("Nintendo Switch")).toBeChecked());
    expect(screen.getByLabelText("PC (Microsoft Windows)")).not.toBeChecked();
  });

  it("saves hidden platform names, not IGDB ids", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    mockFetch();
    renderSection();

    await screen.findByLabelText("Nintendo Switch");
    fireEvent.click(screen.getByLabelText("Nintendo Switch"));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/settings", {
        hiddenPlatforms: ["Nintendo Switch"],
      })
    );
  });

  it("preserves stored names that IGDB no longer reports", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    mockFetch({ hiddenPlatforms: ["Legacy Console", "Nintendo Switch"] });
    renderSection();

    await screen.findByLabelText("Nintendo Switch");
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/settings", {
        hiddenPlatforms: ["Legacy Console", "Nintendo Switch"],
      })
    );
  });

  it("filters the reused platform picker by search text", async () => {
    mockFetch();
    renderSection();

    await screen.findByText("Nintendo Switch");
    fireEvent.change(screen.getByPlaceholderText("Search platforms..."), {
      target: { value: "playstation" },
    });

    expect(screen.queryByText("Nintendo Switch")).not.toBeInTheDocument();
    expect(screen.getByText("PlayStation 5")).toBeInTheDocument();
  });
});
