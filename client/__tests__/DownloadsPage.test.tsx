/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Downloads from "../src/pages/downloads";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("../src/components/DownloadDetailsModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ClaimDownloadModal", () => ({
  default: () => null,
}));

vi.mock("@/components/ClaimBatchModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="claim-batch-modal">Claim batch modal</div> : null,
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const response = await fetch(queryKey.join(""));
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        },
      },
      mutations: {
        retry: false,
      },
    },
  });

describe("Downloads page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/downloads")) {
        return {
          ok: true,
          json: async () => ({ downloads: [], errors: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  it("keeps the scan unlinked action available and opens the batch modal", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Downloads />
      </QueryClientProvider>
    );

    const scanButton = await screen.findByRole("button", { name: "Scan unlinked downloads" });
    expect(scanButton).toHaveTextContent("Scan");

    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByTestId("claim-batch-modal")).toBeInTheDocument();
    });
  });
});
