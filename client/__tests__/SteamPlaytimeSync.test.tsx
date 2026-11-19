/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./test-utils";
import { SteamPlaytimeSync, type SteamPlaytimeStatus } from "../src/components/SteamPlaytimeSync";
import { ApiError } from "@/lib/queryClient";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest,
}));

let status: SteamPlaytimeStatus;
const respond = (body: unknown) => ({ json: async () => body });

function setup() {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SteamPlaytimeSync />
    </QueryClientProvider>
  );
}

describe("Steam play-time sync card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = {
      available: true,
      enabled: false,
      lastSyncAt: null,
      lastSessionsAdded: 0,
      lastMinutesAdded: 0,
      lastError: null,
    };
    apiRequest.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (method === "PUT") {
        status = { ...status, enabled: (body as { enabled: boolean }).enabled };
        return respond(status);
      }
      if (path.endsWith("/sync")) {
        status = {
          ...status,
          lastSyncAt: "2026-11-08T10:00:00.000Z",
          lastSessionsAdded: 2,
          lastMinutesAdded: 135,
        };
        return respond({ result: { sessionsAdded: 2, minutesAdded: 135, baselined: 0 }, status });
      }
      return respond(status);
    });
  });
  afterEach(cleanup);

  it("turns the sync on and shows the last result after a manual run", async () => {
    setup();
    const toggle = await screen.findByRole("switch", { name: "Sync Steam play time" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText(/Not synced yet/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/2 sessions, 2h 15m/)).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/steam/playtime/sync");
    expect(await screen.findByText("Added 2 estimated sessions.")).toBeVisible();
  });

  it("disables the switch and explains what is missing when Steam is not set up", async () => {
    status = { ...status, available: false };
    setup();
    expect(await screen.findByText(/Save your Steam ID above/)).toBeVisible();
    expect(screen.getByRole("switch", { name: "Sync Steam play time" })).toBeDisabled();
  });

  it("shows the stored failure message and the request error", async () => {
    status = { ...status, enabled: true, lastError: "Could not read your Steam play time." };
    apiRequest.mockImplementation(async (method: string, path: string) => {
      if (path.endsWith("/sync")) throw new ApiError(502, "Steam is unreachable");
      return respond(status);
    });
    setup();
    expect(await screen.findByText("Could not read your Steam play time.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(screen.getByText("Steam is unreachable")).toBeVisible());
  });
});

describe("Steam play-time history import", () => {
  afterEach(cleanup);

  it("previews, lets the user untick a game and imports the rest", async () => {
    const posted: unknown[] = [];
    apiRequest.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path.endsWith("/import/preview")) {
        return respond({
          skipped: 0,
          candidates: [
            {
              gameId: "g1",
              title: "Hades",
              steamMinutes: 600,
              recordedMinutes: 60,
              importMinutes: 540,
              lastPlayedAt: "2026-10-01T20:00:00.000Z",
            },
            {
              gameId: "g2",
              title: "Celeste",
              steamMinutes: 120,
              recordedMinutes: 0,
              importMinutes: 120,
              lastPlayedAt: null,
            },
          ],
        });
      }
      if (method === "POST" && path.endsWith("/import")) {
        posted.push(body);
        return respond({ sessionsAdded: 1, minutesAdded: 540 });
      }
      return respond({
        available: true,
        enabled: false,
        lastSyncAt: null,
        lastSessionsAdded: 0,
        lastMinutesAdded: 0,
        lastError: null,
      });
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("Hades")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Celeste/ }));
    fireEvent.click(screen.getByRole("button", { name: /Import 1 game/ }));
    await waitFor(() => expect(posted).toEqual([{ gameIds: ["g1"] }]));
    expect(await screen.findByText(/Imported 1 session/)).toBeTruthy();
  });

  it("says when nothing is missing", async () => {
    apiRequest.mockImplementation(async (_method: string, path: string) =>
      respond(
        path.endsWith("/import/preview")
          ? { candidates: [], skipped: 0 }
          : {
              available: true,
              enabled: false,
              lastSyncAt: null,
              lastSessionsAdded: 0,
              lastMinutesAdded: 0,
              lastError: null,
            }
      )
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Preview import" }));
    expect(await screen.findByText(/Nothing to import/)).toBeTruthy();
  });
});
