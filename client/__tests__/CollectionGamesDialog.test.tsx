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

const client = new QueryClient();

function dialog(memberIds: string[]) {
  return (
    <QueryClientProvider client={client}>
      <CollectionGamesDialog
        open
        onOpenChange={vi.fn()}
        collectionId="c1"
        collectionName="Co-op"
        memberIds={new Set(memberIds)}
      />
    </QueryClientProvider>
  );
}

function renderDialog() {
  return render(dialog(["g1"]));
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

  it("moves focus to the replacement control once the game becomes a member", async () => {
    const { rerender } = renderDialog();
    const add = screen.getByRole("button", { name: "Add Beta" });
    add.focus();
    fireEvent.click(add);
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    rerender(dialog(["g1", "g2"]));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove Beta" }))
    );
  });

  it("leaves focus alone when the user moved to the search field", async () => {
    const { rerender } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add Beta" }));
    const search = screen.getByLabelText("Search your library");
    search.focus();
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    rerender(dialog(["g1", "g2"]));
    await screen.findByRole("button", { name: "Remove Beta" });
    expect(document.activeElement).toBe(search);
  });
});
