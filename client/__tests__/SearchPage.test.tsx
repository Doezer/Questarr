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

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub fetch: search query is gated on input, downloaders returns empty list
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as typeof fetch;
  });

  it("renders the Search heading and search input", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SearchPage />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter game title...")).toBeInTheDocument();
  });
});
