/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import BlacklistedReleasesList from "@/components/BlacklistedReleasesList";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

const originalFetch = globalThis.fetch;

describe("BlacklistedReleasesList", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("shows a load error with a retry instead of an empty list when the request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: "bl-1",
            gameId: "game-1",
            gameTitle: "Space Quest",
            releaseTitle: "Space.Quest-GROUP",
            indexerName: null,
            createdAt: null,
          },
        ],
      } as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <BlacklistedReleasesList />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Could not load blacklisted releases.")).toBeInTheDocument();
    expect(screen.queryByText("No blacklisted releases.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Space.Quest-GROUP")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
