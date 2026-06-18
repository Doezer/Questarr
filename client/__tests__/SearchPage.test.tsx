/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "../src/pages/search";
import { createTestQueryClient } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    apiRequest: vi.fn(async () => ({ json: async () => ({}) })),
    queryClient: new QueryClient(),
    clearSearchCache: vi.fn(),
  };
});

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as typeof fetch;
  });

  it("renders the Search heading and search form", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SearchPage />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter game title...")).toBeInTheDocument();
  });
});
