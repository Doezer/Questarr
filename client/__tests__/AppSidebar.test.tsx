/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Game } from "@shared/schema";

import AppSidebar from "../src/components/AppSidebar";
import { SidebarProvider } from "../src/components/ui/sidebar";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout: vi.fn(), user: { username: "tester" } }),
}));

vi.mock("@/components/GitHubVersionLink", () => ({
  GitHubVersionLink: () => null,
}));

function renderSidebar(statuses: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: () => null } },
  });
  queryClient.setQueryData(
    ["/api/games"],
    statuses.map((status, i) => ({ id: `g${i}`, status }) as unknown as Game)
  );
  queryClient.setQueryData(["/api/downloads"], { downloads: [] });
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </QueryClientProvider>
  );
}

describe("AppSidebar library counts", () => {
  it("shows the library total, wishlist and playing counts", () => {
    renderSidebar(["wanted", "playing", "playing", "owned", "completed"]);

    expect(screen.getByRole("button", { name: "All Games, 5 games" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wishlist, 1 game" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playing, 2 games" })).toBeInTheDocument();
    expect(screen.getByTestId("badge-all-games")).toHaveTextContent("5");
    expect(screen.getByTestId("badge-playing")).toHaveTextContent("2");
  });

  it("styles the playing count with the playing status color, unlike the wishlist", () => {
    renderSidebar(["wanted", "playing"]);

    expect(screen.getByTestId("badge-playing")).toHaveClass("bg-cyan-600");
    expect(screen.getByTestId("badge-wishlist")).not.toHaveClass("bg-cyan-600");
  });

  it("hides the counts when there is nothing to count", () => {
    renderSidebar([]);

    expect(screen.queryByTestId("badge-all-games")).not.toBeInTheDocument();
    expect(screen.queryByTestId("badge-playing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playing" })).toBeInTheDocument();
  });
});
