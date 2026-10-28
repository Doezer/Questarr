/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./test-utils";
import { SteamLibraryImport } from "../src/components/SteamLibraryImport";
import { ApiError } from "@/lib/queryClient";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest,
}));

function setup() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SteamLibraryImport />
    </QueryClientProvider>
  );
}
const games = [
  { steamAppId: 10, title: "First", alreadyTracked: false },
  { steamAppId: 20, title: "Second", alreadyTracked: true },
  { steamAppId: 30, title: "Third", alreadyTracked: false },
];

describe("Steam owned-library import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);
  it("keeps explicit selections while filtering and submits only selected IDs", async () => {
    apiRequest.mockResolvedValueOnce({ json: async () => ({ games }) });
    apiRequest.mockResolvedValueOnce({
      json: async () => ({ results: [{ steamAppId: 10, title: "First", outcome: "added" }] }),
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByRole("checkbox", { name: "Import Second" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Import First" }));
    fireEvent.change(screen.getByLabelText("Filter owned Steam games"), {
      target: { value: "Third" },
    });
    expect(screen.queryByRole("checkbox", { name: "Import First" })).not.toBeInTheDocument();
    expect(screen.getByText("3 games in Steam · 1 selected")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Import selected (1)" }));
    expect(await screen.findByText("First: Added as Owned")).toBeVisible();
    expect(apiRequest).toHaveBeenLastCalledWith("POST", "/api/steam/library/import", {
      appIds: [10],
    });
    fireEvent.change(screen.getByLabelText("Filter owned Steam games"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "Import First" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import selected (0)" })).toBeDisabled();
  });

  it("shows an actionable error and lets an empty preview retry", async () => {
    apiRequest.mockRejectedValueOnce(new ApiError(502, "Make Game details public"));
    apiRequest.mockResolvedValueOnce({ json: async () => ({ games: [] }) });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Make Game details public");
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    expect(await screen.findByText("0 games in Steam · 0 selected")).toBeVisible();
    expect(screen.getByText("No games match.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the selection after failed imports and reports partial outcomes", async () => {
    apiRequest.mockResolvedValueOnce({ json: async () => ({ games }) });
    apiRequest.mockRejectedValueOnce(new Error("network unavailable"));
    apiRequest.mockResolvedValueOnce({
      json: async () => ({
        results: [
          { steamAppId: 10, title: "First", outcome: "not_found" },
          { steamAppId: 30, title: "Third", outcome: "failed" },
        ],
      }),
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview owned games" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Import First" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Import Third" }));
    fireEvent.click(screen.getByRole("button", { name: "Import selected (2)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Import selected (2)" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Import selected (2)" }));
    expect(await screen.findByText("First: No eligible IGDB match — skipped")).toBeVisible();
    expect(screen.getByText("Third: Import failed — retry this game")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Import First" })).toBeEnabled();
  });
});
