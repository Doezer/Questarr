/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import PlayTimerButton from "../src/components/PlayTimerButton";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const session = (gameId: string) => ({
  id: "s-1",
  gameId,
  userId: "u",
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  endedAt: null,
  source: "timer",
});

function mockActive(active: ReturnType<typeof session> | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const body = getRequestUrl(url).includes("/api/play-sessions/active")
      ? { session: active }
      : {};
    return { ok: true, json: async () => body } as Response;
  });
}

function renderButton(variant: "full" | "icon" = "full") {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PlayTimerButton gameId="g-1" gameTitle="Portal" variant={variant} />
    </QueryClientProvider>
  );
}

describe("PlayTimerButton", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    mockToast.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts the timer for the game", async () => {
    mockActive(null);
    renderButton();

    fireEvent.click(await screen.findByRole("button", { name: "Start timer for Portal" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/games/g-1/play-sessions/start")
    );
  });

  it("shows the elapsed time and stops the running timer", async () => {
    mockActive(session("g-1"));
    renderButton();

    const stop = await screen.findByRole("button", { name: "Stop timer for Portal" });
    expect(stop).toHaveTextContent(/0:01:0\d/);

    fireEvent.click(stop);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/play-sessions/s-1/stop")
    );
  });

  it("is disabled while another game's timer runs", async () => {
    mockActive(session("g-2"));
    renderButton();

    const button = await screen.findByRole("button", { name: "Start timer for Portal" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("title", "Another game's timer is running");
  });

  it("renders a compact icon button in list rows", async () => {
    mockActive(null);
    renderButton("icon");

    const button = await screen.findByRole("button", { name: "Start timer for Portal" });
    expect(button).not.toHaveTextContent("Start timer");
  });

  it("tells the user when the server says another timer is running", async () => {
    mockActive(null);
    const { ApiError } = await import("../src/lib/queryClient");
    apiRequest.mockRejectedValueOnce(new ApiError(409, "already running", {}));
    renderButton();

    fireEvent.click(await screen.findByRole("button", { name: "Start timer for Portal" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining("already running") })
      )
    );
  });
});
