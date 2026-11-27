/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManualImportModal from "../src/components/ManualImportModal";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("../src/components/FileBrowser", () => ({
  FileBrowser: ({
    open,
    onMultiSelect,
  }: {
    open: boolean;
    onMultiSelect?: (paths: string[]) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onMultiSelect?.(["/source/one.zip"])}>
        Select test files
      </button>
    ) : null,
}));

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("Manual Import game picker", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const target = getRequestUrl(url);
      if (target.includes("/api/games")) {
        return createJsonResponse([
          { id: "game-hades", title: "Hades", hidden: false },
          { id: "game-hades-ii", title: "Hades II", hidden: false },
          { id: "game-elden", title: "Elden Ring", hidden: false },
          {
            id: "game-elden-dlc",
            title: "Elden Ring: Shadow of the Erdtree",
            hidden: false,
          },
        ]);
      }
      if (target.includes("/api/platform-folders")) return createJsonResponse([]);
      if (target.includes("/api/imports/config")) return createJsonResponse({});
      return createJsonResponse({});
    });
  });

  it("keeps prefix titles selectable while typing and auto-selects the completed title", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ManualImportModal open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select test files" }));

    let search = await screen.findByRole("textbox", {
      name: "Search library games for one.zip",
    });
    fireEvent.change(search, { target: { value: "hades" } });

    expect(screen.getByRole("textbox", { name: "Search library games for one.zip" })).toHaveValue(
      "hades"
    );
    expect(screen.getByRole("button", { name: "Hades" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hades II" })).toBeInTheDocument();

    search = screen.getByRole("textbox", { name: "Search library games for one.zip" });
    fireEvent.change(search, { target: { value: "hades ii" } });

    expect(
      await screen.findByRole("button", { name: "Clear game assignment for one.zip" })
    ).toBeInTheDocument();
    expect(screen.getByText("Hades II")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear game assignment for one.zip" }));
    search = await screen.findByRole("textbox", {
      name: "Search library games for one.zip",
    });
    fireEvent.change(search, { target: { value: "elden" } });

    fireEvent.click(
      await screen.findByRole("button", { name: "Elden Ring: Shadow of the Erdtree" })
    );
    expect(
      await screen.findByRole("button", { name: "Clear game assignment for one.zip" })
    ).toBeInTheDocument();
    expect(screen.getByText("Elden Ring: Shadow of the Erdtree")).toBeInTheDocument();
  });

  it("does not auto-select a shorter exact title when games load after typing", async () => {
    let resolveGames: ((response: Response) => void) | undefined;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const target = getRequestUrl(url);
      if (target.includes("/api/games")) {
        return await new Promise<Response>((resolve) => {
          resolveGames = resolve;
        });
      }
      if (target.includes("/api/platform-folders")) return createJsonResponse([]);
      if (target.includes("/api/imports/config")) return createJsonResponse({});
      return createJsonResponse({});
    });

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ManualImportModal open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select test files" }));
    fireEvent.change(
      await screen.findByRole("textbox", { name: "Search library games for one.zip" }),
      { target: { value: "hades" } }
    );

    await waitFor(() => expect(resolveGames).toBeDefined());
    resolveGames?.(
      createJsonResponse([
        { id: "game-hades", title: "Hades", hidden: false },
        { id: "game-hades-ii", title: "Hades II", hidden: false },
      ])
    );

    expect(await screen.findByRole("button", { name: "Hades" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hades II" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search library games for one.zip" })).toHaveValue(
      "hades"
    );
    expect(
      screen.queryByRole("button", { name: "Clear game assignment for one.zip" })
    ).not.toBeInTheDocument();
  });
});
