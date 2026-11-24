/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./test-utils";
import {
  RetroAchievementsSync,
  type RetroAchievementsStatus,
} from "../src/components/RetroAchievementsSync";
import { ApiError } from "@/lib/queryClient";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest,
}));

let status: RetroAchievementsStatus;
const respond = (body: unknown) => ({ json: async () => body });

function setup() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RetroAchievementsSync />
    </QueryClientProvider>
  );
}

describe("RetroAchievements sync card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = {
      available: false,
      enabled: false,
      username: null,
      lastSyncAt: null,
      lastGamesSynced: 0,
      lastNewUnlocks: 0,
      lastError: null,
    };
    apiRequest.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path === "/api/retroachievements/credentials" && method === "PUT") {
        status = { ...status, available: true, username: (body as { username: string }).username };
        return respond(status);
      }
      if (path === "/api/retroachievements/credentials" && method === "DELETE") {
        status = { ...status, available: false, enabled: false, username: null };
        return respond(status);
      }
      if (path === "/api/retroachievements" && method === "PUT") {
        status = { ...status, enabled: (body as { enabled: boolean }).enabled };
        return respond(status);
      }
      if (path.endsWith("/sync")) {
        status = {
          ...status,
          lastSyncAt: "2026-11-24T10:00:00.000Z",
          lastGamesSynced: 3,
          lastNewUnlocks: 2,
        };
        return respond({ result: { gamesSynced: 3, newUnlocks: 2 }, status });
      }
      return respond(status);
    });
  });
  afterEach(cleanup);

  it("saves the account, turns the sync on and shows the result of a manual run", async () => {
    setup();
    const toggle = await screen.findByRole("switch", { name: "Sync RetroAchievements" });
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save account" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("RetroAchievements username"), {
      target: { value: "Mario" },
    });
    fireEvent.change(screen.getByLabelText("Web API key"), {
      target: { value: "abcdef0123456789abcdef0123456789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/retroachievements/credentials", {
        username: "Mario",
        apiKey: "abcdef0123456789abcdef0123456789",
      })
    );
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(screen.getByLabelText("Web API key")).toHaveValue("");
    expect(screen.getByLabelText("Web API key")).toHaveAttribute(
      "placeholder",
      "Saved (leave empty to keep it)"
    );

    fireEvent.click(toggle);
    expect(await screen.findByText(/Not synced yet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/3 games matched, 2 new unlocks/)).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/retroachievements/sync");
  });

  it("renames the account without retyping the saved key", async () => {
    status = { ...status, available: true, username: "Mario" };
    setup();
    const username = await screen.findByLabelText("RetroAchievements username");
    await waitFor(() => expect(username).toHaveValue("Mario"));
    fireEvent.change(username, { target: { value: "Luigi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/retroachievements/credentials", {
        username: "Luigi",
      })
    );
  });

  it("shows the server's reason when the account is rejected, and removes the account", async () => {
    status = { ...status, available: true, username: "Mario", enabled: true };
    setup();
    await screen.findByRole("button", { name: "Remove account" });
    apiRequest.mockImplementationOnce(async () => {
      throw new ApiError(400, "RetroAchievements rejected the username or Web API key.");
    });
    fireEvent.change(screen.getByLabelText("Web API key"), {
      target: { value: "wrongwrongwrongwrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/rejected the username/);

    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/retroachievements/credentials")
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Sync RetroAchievements" })).not.toBeChecked()
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
