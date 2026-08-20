/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LinkGameModal from "../src/components/LinkGameModal";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

function createJsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function renderModal(onOpenChange = vi.fn()) {
  const client = createTestQueryClient();
  const invalidateQueries = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <LinkGameModal
        open
        onOpenChange={onOpenChange}
        downloadId="dl-1"
        downloadTitle="Orphaned.Release-GROUP"
      />
    </QueryClientProvider>
  );
  return { onOpenChange, invalidateQueries };
}

describe("LinkGameModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the user's games and links the selected one on confirm", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = getRequestUrl(url);
      if (href.startsWith("/api/games")) {
        return createJsonResponse([
          { id: "g1", title: "Chrono Trigger", coverUrl: null },
          { id: "g2", title: "Chrono Cross", coverUrl: null },
        ]);
      }
      if (href.includes("/api/imports/dl-1/link") && init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toEqual({ gameId: "g1" });
        return createJsonResponse({ success: true });
      }
      return createJsonResponse({});
    });

    const { onOpenChange, invalidateQueries } = renderModal();

    expect(await screen.findByText("Chrono Trigger")).toBeInTheDocument();
    expect(screen.getByText("Chrono Cross")).toBeInTheDocument();

    // Link button starts disabled until a game is selected.
    expect(screen.getByRole("button", { name: "Link Game" })).toBeDisabled();

    fireEvent.click(screen.getByText("Chrono Trigger"));
    expect(screen.getByRole("button", { name: "Link Game" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Link Game" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/imports/pending"] });
  });

  it("shows an empty state when the search returns no games", async () => {
    globalThis.fetch = vi.fn(async () => createJsonResponse([]));

    renderModal();

    expect(await screen.findByText(/No games found\. Try a different search/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link Game" })).toBeDisabled();
  });
});
