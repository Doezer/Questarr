/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import { PlayniteSyncStatus } from "@/components/PlayniteSyncStatus";
import { SyncedStatusNote } from "@/components/SyncedStatusNote";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const json = (body: unknown) => ({ json: async () => body });

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

describe("PlayniteSyncStatus", () => {
  beforeEach(() => apiRequest.mockReset());

  it("shows the last request of each kind, a failure and the synced sources", async () => {
    apiRequest.mockResolvedValue(
      json({
        playStatus: {
          at: "2026-11-20T10:00:00.000Z",
          counts: { received: 5, updated: 2, unchanged: 1, skipped: 1, unmatched: 1 },
          error: null,
        },
        libraryImport: { at: null, counts: {}, error: null },
        playTime: {
          at: null,
          counts: {},
          error: { at: "2026-11-20T11:00:00.000Z", message: "The server could not import." },
        },
        syncedStatuses: { steam: 3, epic: 1 },
      })
    );
    wrap(<PlayniteSyncStatus />);

    expect(await screen.findByText(/5 games in that request: 2 updated/)).toBeInTheDocument();
    expect(screen.getAllByText("Never succeeded")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("The server could not import.");
    expect(screen.getByTestId("playnite-sync-sources")).toHaveTextContent("Epic 1, Steam 3");
  });
});

describe("SyncedStatusNote", () => {
  beforeEach(() => apiRequest.mockReset());

  it("renders nothing for a status the user set", () => {
    const { container } = wrap(<SyncedStatusNote gameId="g1" status="playing" syncSource={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the status by writing it again without a sync source", async () => {
    apiRequest.mockResolvedValue(json({}));
    wrap(<SyncedStatusNote gameId="g1" status="completed" syncSource="gog" />);

    expect(screen.getByTestId("text-status-source-g1")).toHaveTextContent("Synced from GOG");
    fireEvent.click(screen.getByRole("button", { name: /Keep this status/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/games/g1/status", {
        status: "completed",
      })
    );
  });

  it("does not offer to keep an owned status, which a sync may still move", () => {
    wrap(<SyncedStatusNote gameId="g1" status="owned" syncSource="steam" />);
    expect(screen.getByTestId("text-status-source-g1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
