/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GameTagsField from "@/components/GameTagsField";
import { TagsSettings } from "@/components/TagsSettings";
import { findTagByName, safeTagColor, type GameTagEntry, type Tag } from "@/lib/tags";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequest(...args) };
});

const GAME_ID = "22222222-2222-2222-2222-222222222222";

function makeTag(id: string, name: string, color: string | null = "#ff0000"): Tag {
  return { id, userId: "user-1", name, color, createdAt: null, updatedAt: null } as Tag;
}

const coop = makeTag("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Co-op");
const retro = makeTag("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Retro", null);

function renderWith(ui: React.ReactElement, tags: Tag[], gameTags: GameTagEntry[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(["/api/tags"], tags);
  client.setQueryData(["/api/games", GAME_ID, "tags"], gameTags);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("tag helpers", () => {
  it("finds a tag by name ignoring case and spaces", () => {
    expect(findTagByName([coop, retro], "  co-OP ")?.id).toBe(coop.id);
    expect(findTagByName([coop], "missing")).toBeUndefined();
  });

  it("only accepts #rrggbb colors for style attributes", () => {
    expect(safeTagColor("#A1b2C3")).toBe("#A1b2C3");
    expect(safeTagColor("red; background:url(x)")).toBeUndefined();
    expect(safeTagColor(null)).toBeUndefined();
  });
});

describe("GameTagsField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(async () => ({ json: async () => ({}) }));
  });

  it("lists the tags on the game and offers the others as one-click buttons", () => {
    renderWith(
      <GameTagsField gameId={GAME_ID} />,
      [coop, retro],
      [{ id: "gt-1", gameId: GAME_ID, tagId: coop.id, tag: coop }]
    );

    expect(screen.getByTestId(`game-tag-${coop.id}`)).toHaveTextContent("Co-op");
    expect(screen.getByRole("button", { name: "Remove tag Co-op" })).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Existing tags" }).querySelectorAll("button")
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Retro" })).toBeInTheDocument();
  });

  it("attaches an existing tag when its name is typed, without creating a duplicate", async () => {
    renderWith(<GameTagsField gameId={GAME_ID} />, [coop, retro]);

    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "retro" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", `/api/games/${GAME_ID}/tags`, {
        tagId: retro.id,
      })
    );
    expect(apiRequest).not.toHaveBeenCalledWith("POST", "/api/tags", expect.anything());
  });

  it("creates the tag first when the name is new", async () => {
    apiRequest.mockImplementation(async (method: string, url: string) => ({
      json: async () => (method === "POST" && url === "/api/tags" ? makeTag("new-id", "Cozy") : {}),
    }));
    renderWith(<GameTagsField gameId={GAME_ID} />, [coop]);

    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "  Cozy " } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", `/api/games/${GAME_ID}/tags`, {
        tagId: "new-id",
      })
    );
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/tags", { name: "Cozy" });
  });

  it("removes a tag from the game", async () => {
    renderWith(
      <GameTagsField gameId={GAME_ID} />,
      [coop],
      [{ id: "gt-1", gameId: GAME_ID, tagId: coop.id, tag: coop }]
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag Co-op" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("DELETE", `/api/games/${GAME_ID}/tags/${coop.id}`)
    );
  });

  it("shows an error toast when adding fails", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    renderWith(<GameTagsField gameId={GAME_ID} />, [coop, retro]);

    fireEvent.click(screen.getByRole("button", { name: "Retro" }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Could not add the tag", variant: "destructive" })
      )
    );
  });
});

describe("TagsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockImplementation(async () => ({ json: async () => ({}) }));
  });

  it("creates a tag with its color", async () => {
    renderWith(<TagsSettings />, []);

    expect(screen.getByText("No tags yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: " Backlog " } });
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#10b981" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/tags", {
        name: "Backlog",
        color: "#10b981",
      })
    );
  });

  it("blocks a name the user already has", () => {
    renderWith(<TagsSettings />, [coop]);

    fireEvent.change(screen.getByLabelText("New tag"), { target: { value: "co-op" } });

    expect(screen.getByRole("alert")).toHaveTextContent("already have a tag");
    expect(screen.getByRole("button", { name: "Add tag" })).toBeDisabled();
  });

  it("renames a tag", async () => {
    renderWith(<TagsSettings />, [coop]);

    fireEvent.click(screen.getByRole("button", { name: "Edit tag Co-op" }));
    fireEvent.change(screen.getByLabelText("Name of tag Co-op"), {
      target: { value: "Local co-op" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", `/api/tags/${coop.id}`, {
        name: "Local co-op",
        color: "#ff0000",
      })
    );
  });

  it("asks for confirmation before deleting a tag", async () => {
    renderWith(<TagsSettings />, [coop]);

    fireEvent.click(screen.getByRole("button", { name: "Delete tag Co-op" }));
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete tag" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("DELETE", `/api/tags/${coop.id}`));
  });
});

describe("GameTagsField retry", () => {
  it("refreshes the tag list when attaching a freshly created tag fails", async () => {
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (url === "/api/tags") return { json: async () => makeTag("new-id", "Cozy") };
      if (method === "POST") throw new Error("attach failed");
      return { json: async () => ({}) };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["/api/tags"], []);
    client.setQueryData(["/api/games", GAME_ID, "tags"], []);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <GameTagsField gameId={GAME_ID} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "Cozy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });
  it("retries by attaching the tag it already created instead of creating it again", async () => {
    const posts: string[] = [];
    apiRequest.mockImplementation(async (method: string, url: string) => {
      posts.push(`${method} ${url}`);
      if (url === "/api/tags") return { json: async () => makeTag("new-id", "Cozy") };
      if (method === "POST" && posts.filter((p) => p.endsWith("/tags")).length === 2) {
        throw new Error("attach failed");
      }
      return { json: async () => ({}) };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["/api/tags"], []);
    client.setQueryData(["/api/games", GAME_ID, "tags"], []);
    render(
      <QueryClientProvider client={client}>
        <GameTagsField gameId={GAME_ID} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "Cozy" } });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add tag" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    await waitFor(() => expect(posts).toHaveLength(3));

    expect(posts.filter((p) => p === "POST /api/tags")).toHaveLength(1);
  });
});
