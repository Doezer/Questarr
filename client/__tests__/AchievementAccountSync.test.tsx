/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./test-utils";
import { PsnAchievementsSync } from "../src/components/PsnAchievementsSync";
import { XboxAchievementsSync } from "../src/components/XboxAchievementsSync";
import type { AchievementAccountStatus } from "../src/components/AchievementAccountSync";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  apiRequest,
}));

const respond = (body: unknown) => ({ json: async () => body });

const cases = [
  {
    name: "PlayStation",
    Component: PsnAchievementsSync,
    apiPath: "/api/psn-achievements",
    secretLabel: "NPSSO token",
    bodyKey: "npsso",
    secret: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6",
    account: "4242424242",
  },
  {
    name: "Xbox",
    Component: XboxAchievementsSync,
    apiPath: "/api/xbox-achievements",
    secretLabel: "OpenXBL API key",
    bodyKey: "apiKey",
    secret: "abcd1234-ef56-7890-abcd-ef1234567890",
    account: "MasterChief",
  },
];

describe.each(cases)("$name sync card", (c) => {
  let status: AchievementAccountStatus;

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
      if (path === `${c.apiPath}/credentials` && method === "PUT") {
        status = { ...status, available: true, username: c.account };
        return respond(status);
      }
      if (path === `${c.apiPath}/credentials` && method === "DELETE") {
        status = { ...status, available: false, enabled: false, username: null };
        return respond(status);
      }
      if (path === c.apiPath && method === "PUT") {
        status = { ...status, enabled: (body as { enabled: boolean }).enabled };
        return respond(status);
      }
      if (path.endsWith("/sync")) {
        status = {
          ...status,
          lastSyncAt: "2026-11-24T10:00:00.000Z",
          lastGamesSynced: 2,
          lastNewUnlocks: 1,
        };
        return respond({ result: { gamesSynced: 2, newUnlocks: 1 }, status });
      }
      return respond(status);
    });
  });
  afterEach(cleanup);

  it("asks only for the secret, shows the connected account and syncs on demand", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <c.Component />
      </QueryClientProvider>
    );
    const toggle = await screen.findByRole("switch", { name: `Sync ${c.name}` });
    expect(toggle).toBeDisabled();
    expect(screen.queryByLabelText(/username/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Save account" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(c.secretLabel), { target: { value: c.secret } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(apiRequest).toHaveBeenCalledWith("PUT", `${c.apiPath}/credentials`, {
      [c.bodyKey]: c.secret,
    });
    expect(await screen.findByText(c.account)).toBeInTheDocument();
    // The secret field is cleared once the account is saved.
    expect(screen.getByLabelText(c.secretLabel)).toHaveValue("");

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByText(/2 games matched, 1 new unlock/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
    await waitFor(() => expect(toggle).toBeDisabled());
  });

  it("shows the refusal of a secret", async () => {
    const { ApiError } = await import("@/lib/queryClient");
    apiRequest.mockImplementation(async (method: string, path: string) => {
      if (method === "PUT" && path.endsWith("/credentials")) {
        throw new ApiError(400, "The provider refused the key.");
      }
      return respond(status);
    });
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <c.Component />
      </QueryClientProvider>
    );
    fireEvent.change(await screen.findByLabelText(c.secretLabel), { target: { value: c.secret } });
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The provider refused the key.");
    // Editing the field clears the error.
    fireEvent.change(screen.getByLabelText(c.secretLabel), { target: { value: `${c.secret}x` } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
