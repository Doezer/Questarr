import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CollectionGamesDialog from "@/components/CollectionGamesDialog";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-fresh-games", () => ({
  useFreshGames: () => ({
    games: [
      { id: "g1", title: "Alpha", coverUrl: null },
      { id: "g2", title: "Beta", coverUrl: null },
    ],
    isLoading: false,
    isError: false,
    retry: vi.fn(),
  }),
}));

function renderDialog() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CollectionGamesDialog
        open
        onOpenChange={vi.fn()}
        collectionId="c1"
        collectionName="Co-op"
        memberIds={new Set(["g1"])}
      />
    </QueryClientProvider>
  );
}

describe("CollectionGamesDialog", () => {
  beforeEach(() => apiRequest.mockReset().mockResolvedValue({}));

  it("adds a game that is not yet a member", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add Beta" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/collections/c1/games", {
        gameId: "g2",
      })
    );
  });

  it("shows members as Added without an add button", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: "Add Alpha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Alpha" })).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
  });

  it("removes a member", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Remove Alpha" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/collections/c1/games/g1")
    );
  });
});
