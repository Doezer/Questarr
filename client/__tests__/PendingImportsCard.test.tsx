/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import PendingImportsCard from "../src/components/PendingImportsCard";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

vi.mock("../src/components/ImportReviewModal", () => ({
  default: () => null,
}));
vi.mock("../src/components/LinkGameModal", () => ({
  default: () => null,
}));

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function renderCard() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PendingImportsCard />
    </QueryClientProvider>
  );
}

describe("PendingImportsCard", () => {
  it("renders nothing when there are no pending imports", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse([]));
    globalThis.fetch = fetchMock;

    const { container } = renderCard();

    // Wait for the pending-imports query to actually resolve before asserting
    // the empty render, rather than racing an arbitrary findByText timeout.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("surfaces the failure reason for a download flagged after a failed import attempt", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (getRequestUrl(url).includes("/api/imports/pending")) {
        return createJsonResponse([
          {
            id: "dl-1",
            gameTitle: "My Game",
            downloadTitle: "My.Game.Release-GROUP",
            status: "manual_review_required",
            createdAt: new Date().toISOString(),
            errorMessage: "disk full",
          },
        ]);
      }
      return createJsonResponse({});
    });

    renderCard();

    expect(await screen.findByText("My Game")).toBeInTheDocument();
    expect(screen.getByText("Import failed: disk full")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  it("offers a Link Game action for a download whose game record is missing", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (getRequestUrl(url).includes("/api/imports/pending")) {
        return createJsonResponse([
          {
            id: "dl-2",
            // The backend has no game to derive a title from for this status —
            // gameTitle falls back to downloadTitle, so both lines render the
            // same text.
            gameTitle: "Orphaned.Release-GROUP",
            downloadTitle: "Orphaned.Release-GROUP",
            status: "game_link_required",
            createdAt: new Date().toISOString(),
            errorMessage: "This download's linked game could not be found",
          },
        ]);
      }
      return createJsonResponse({});
    });

    renderCard();

    // No "Import failed:" prefix for this case — it isn't a failed import, it's
    // missing a game link.
    expect(
      await screen.findByText("This download's linked game could not be found")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Orphaned.Release-GROUP")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Link Game" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review" })).not.toBeInTheDocument();
  });
});
