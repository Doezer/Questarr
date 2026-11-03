/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { ExternalGamesImport } from "../src/components/ExternalGamesImport";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.hoisted(() => vi.fn(async () => ({ json: async () => ({}) })));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const games = [
  {
    gameId: "g1",
    title: "Hades",
    libraryPath: "/mnt/old/Hades",
    rootFolderId: "r",
    rootFolderPath: "/mnt/old",
  },
  {
    gameId: "g2",
    title: "Celeste",
    libraryPath: "/mnt/old/Celeste",
    rootFolderId: "r",
    rootFolderPath: "/mnt/old",
  },
];

describe("ExternalGamesImport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("imports every selected game with the chosen mode", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () => (getRequestUrl(url).includes("external-games") ? games : {}),
        }) as Response
    );
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ExternalGamesImport />
      </QueryClientProvider>
    );

    const selectAll = await screen.findByLabelText("Select all");
    const batchButton = screen.getByRole("button", { name: /Import selected \(0\)/ });
    expect(batchButton).toBeDisabled();

    fireEvent.click(selectAll);
    fireEvent.click(await screen.findByRole("button", { name: /Import selected \(2\)/ }));
    fireEvent.click(await screen.findByLabelText(/Move/));
    fireEvent.click(screen.getByRole("button", { name: "Move into library" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/external-games/g1/import", {
      mode: "move",
    });
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/external-games/g2/import", {
      mode: "move",
    });
  });
});
