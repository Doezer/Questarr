/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { RommSettings } from "../src/components/RommSettings";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const saved = {
  enabled: true,
  url: "http://romm.lan:8080",
  apiToken: "********",
  platformFolders: false,
  syncEnabled: false,
  scanAfterImport: true,
  lastSync: null,
};

function renderComponent() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RommSettings />
    </QueryClientProvider>
  );
}

describe("RommSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const body = getRequestUrl(url).includes("/api/settings/romm") ? saved : {};
      return { ok: true, json: async () => body } as Response;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads the saved settings and warns about plaintext http", async () => {
    renderComponent();
    expect(await screen.findByDisplayValue("http://romm.lan:8080")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/unencrypted/);
  });

  it("saves the platform folder switch without the sync timestamp", async () => {
    renderComponent();
    await screen.findByDisplayValue("http://romm.lan:8080");
    fireEvent.click(screen.getByLabelText("RomM platform folders"));
    fireEvent.click(screen.getByRole("button", { name: /save romm settings/i }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/settings/romm",
        expect.objectContaining({ platformFolders: true, apiToken: "********" })
      )
    );
    expect(apiRequest.mock.calls[0][2]).not.toHaveProperty("lastSync");
  });

  it("shows the outcome of a sync", async () => {
    apiRequest.mockResolvedValue({
      json: async () => ({
        summary: { totalRoms: 10, matched: 4, alreadyOwned: 1, markedOwned: 3, notInLibrary: 6 },
      }),
    });
    renderComponent();
    await screen.findByDisplayValue("http://romm.lan:8080");
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "10 ROMs in RomM: 4 matched, 3 marked as owned"
    );
  });

  describe("folder repair", () => {
    const proposal = {
      gameId: "g1",
      title: "Pokémon Pokopia",
      from: "/roms/win/Pokopia",
      to: "/roms/switch-2/Pokopia",
      currentFolder: "win",
      expectedFolder: "switch-2",
      destinationExists: false,
    };
    const platformFoldersSaved = { ...saved, platformFolders: true };

    beforeEach(() => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
        const body = getRequestUrl(url).includes("/api/settings/romm") ? platformFoldersSaved : {};
        return { ok: true, json: async () => body } as Response;
      });
    });

    it("needs RomM platform folders to be saved as on", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () => ({ ok: true, json: async () => saved }) as Response
      );
      renderComponent();
      await screen.findByDisplayValue("http://romm.lan:8080");
      expect(screen.getByRole("button", { name: /check library folders/i })).toBeDisabled();
    });

    it("lists the misplaced folders, then moves them after confirmation", async () => {
      apiRequest.mockImplementation(async (method: string) => ({
        json: async () =>
          method === "GET"
            ? { proposals: [proposal] }
            : { results: [{ gameId: "g1", title: proposal.title, moved: true }] },
      }));
      renderComponent();
      await screen.findByDisplayValue("http://romm.lan:8080");
      fireEvent.click(screen.getByRole("button", { name: /check library folders/i }));
      expect(await screen.findByText("Pokémon Pokopia")).toBeInTheDocument();
      expect(apiRequest).not.toHaveBeenCalledWith(
        "POST",
        "/api/settings/romm/folder-repair",
        expect.anything()
      );

      fireEvent.click(screen.getByRole("button", { name: /move 1 game$/i }));
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith("POST", "/api/settings/romm/folder-repair", {
          gameIds: ["g1"],
        })
      );
      expect(await screen.findByText("No misplaced folders found.")).toBeInTheDocument();
    });

    it("says so when nothing is misplaced", async () => {
      apiRequest.mockResolvedValue({ json: async () => ({ proposals: [] }) });
      renderComponent();
      await screen.findByDisplayValue("http://romm.lan:8080");
      fireEvent.click(screen.getByRole("button", { name: /check library folders/i }));
      expect(await screen.findByText("No misplaced folders found.")).toBeInTheDocument();
    });

    it("keeps what moved when a later batch of games fails", async () => {
      const many = Array.from({ length: 501 }, (_, i) => ({
        ...proposal,
        gameId: `g${i}`,
        title: `Game ${i}`,
      }));
      let posts = 0;
      apiRequest.mockImplementation(async (method: string, _url: string, body?: unknown) => {
        if (method === "GET") return { json: async () => ({ proposals: many }) };
        posts += 1;
        if (posts > 1) throw new Error("network down");
        const ids = (body as { gameIds: string[] }).gameIds;
        expect(ids).toHaveLength(500);
        return {
          json: async () => ({
            results: ids.map((gameId) => ({ gameId, title: gameId, moved: true })),
          }),
        };
      });
      renderComponent();
      await screen.findByDisplayValue("http://romm.lan:8080");
      fireEvent.click(screen.getByRole("button", { name: /check library folders/i }));
      await screen.findByText("Game 0");
      fireEvent.click(screen.getByRole("button", { name: /move 501 games/i }));
      expect(await screen.findByText(/Game 500: .*network down/)).toBeInTheDocument();
      expect(screen.queryByText("Game 0")).not.toBeInTheDocument();
    });

    it("keeps a game that could not be moved and shows why", async () => {
      apiRequest.mockImplementation(async (method: string) => ({
        json: async () =>
          method === "GET"
            ? { proposals: [{ ...proposal, destinationExists: true }] }
            : {
                results: [
                  {
                    gameId: "g1",
                    title: proposal.title,
                    moved: false,
                    error: "Destination exists",
                  },
                ],
              },
      }));
      renderComponent();
      await screen.findByDisplayValue("http://romm.lan:8080");
      fireEvent.click(screen.getByRole("button", { name: /check library folders/i }));
      expect(await screen.findByText(/destination already exists/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /move 1 game$/i }));
      expect(await screen.findByText(/Pokémon Pokopia: Destination exists/)).toBeInTheDocument();
    });
  });
});
