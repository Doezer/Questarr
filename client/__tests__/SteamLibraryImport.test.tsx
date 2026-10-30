/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./test-utils";
import { SteamLibraryImport } from "../src/components/SteamLibraryImport";
import { ApiError } from "@/lib/queryClient";
import type { SteamLibraryJobView } from "@shared/steam-library";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest,
}));
const initialGames = [
  { steamAppId: 10, title: "First", alreadyTracked: false },
  { steamAppId: 20, title: "Second", alreadyTracked: true },
  { steamAppId: 30, title: "Third", alreadyTracked: false },
];
let games = initialGames;
let job: SteamLibraryJobView | null = null;
function complete(ids: number[]): SteamLibraryJobView {
  return {
    id: "job",
    state: "completed",
    total: ids.length,
    processed: ids.length,
    added: ids.length,
    duplicates: 0,
    skipped: 0,
    failed: 0,
    completedAppIds: ids,
    recentResults: [],
    canRetry: false,
  };
}
function setup() {
  const client = createTestQueryClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <SteamLibraryImport />
      </QueryClientProvider>
    ),
  };
}

describe("Steam bulk import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    job = null;
    games = initialGames;
    apiRequest.mockImplementation(
      async (method: string, path: string, body?: { appIds: number[] }) => {
        if (path.endsWith("/current")) return { json: async () => ({ job }) };
        if (path.endsWith("/retry")) {
          job = complete([10]);
          return { json: async () => ({ job }) };
        }
        if (method === "POST") {
          job = complete(body!.appIds);
          return { json: async () => ({ job }) };
        }
        return { json: async () => ({ games }) };
      }
    );
  });
  afterEach(cleanup);

  it("preselects 1,000 games, bounds rendered rows and sends one bulk request", async () => {
    games = Array.from({ length: 1000 }, (_, i) => ({
      steamAppId: i + 1,
      title: `Game ${i + 1}`,
      alreadyTracked: false,
    }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByText("1,000 games in Steam · 1,000 selected")).toBeVisible();
    expect(screen.getAllByRole("checkbox")).toHaveLength(50);
    expect(screen.getByText("Page 1 of 20")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("checkbox", { name: "Import Game 51", exact: true })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Import selected (1,000)" }));
    expect(await screen.findByText("Processed 1,000 of 1,000 games")).toBeVisible();
    const posts = apiRequest.mock.calls.filter(([method]) => method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[1]).toBe("/api/steam/library/import/jobs");
    expect(posts[0]?.[2].appIds).toHaveLength(1000);
  });

  it("preserves selections across search/pages and excludes tracked games", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByRole("checkbox", { name: "Import Second" })).toBeDisabled();
    expect(screen.getByText("3 games in Steam · 2 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    fireEvent.change(screen.getByLabelText("Filter owned Steam games"), {
      target: { value: "First" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select all matching (1)" }));
    fireEvent.change(screen.getByLabelText("Filter owned Steam games"), {
      target: { value: "Third" },
    });
    expect(screen.getByText("3 games in Steam · 1 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import selected (1)" }));
    expect(await screen.findByText("Processed 1 of 1 games")).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/steam/library/import/jobs", {
      appIds: [10],
    });
  });

  it("restores server-side progress when reopened without previewing again", async () => {
    job = { ...complete([]), state: "running", total: 1000, processed: 500, added: 500 };
    const first = setup();
    expect(await screen.findByText("Processed 500 of 1,000 games")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Steam import progress" })).toHaveAttribute(
      "value",
      "500"
    );
    expect(screen.getByRole("button", { name: "Preview owned games" })).toBeDisabled();
    first.unmount();
    setup();
    expect(await screen.findByText("Processed 500 of 1,000 games")).toBeVisible();
    expect(apiRequest.mock.calls.filter(([method]) => method === "POST")).toHaveLength(0);
  });

  it("retries unfinished games using the saved server job", async () => {
    job = {
      ...complete([30]),
      state: "failed",
      total: 2,
      failed: 1,
      added: 0,
      canRetry: true,
      message: "Connection interrupted",
    };
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Retry unfinished games" }));
    await waitFor(() => expect(screen.getByText("Import complete")).toBeVisible());
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/steam/library/import/jobs/retry");
  });

  it("shows an actionable preview error and allows a retry", async () => {
    const implementation = apiRequest.getMockImplementation()!;
    let first = true;
    apiRequest.mockImplementation(async (...args) => {
      if (args[1] === "/api/steam/library" && first) {
        first = false;
        throw new ApiError(502, "Make Game details public");
      }
      return implementation(...args);
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Make Game details public");
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByText("3 games in Steam · 2 selected")).toBeVisible();
  });
});
