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
});
