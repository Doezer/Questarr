/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
          { id: "game-hades", title: "Hades II", hidden: false },
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

  it("auto-selects a unique exact match and offers selectable partial matches", async () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ManualImportModal open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Select test files" }));

    let search = await screen.findByRole("textbox", {
      name: "Search library games for one.zip",
    });
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
});
