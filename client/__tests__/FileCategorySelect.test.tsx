/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import FileCategorySelect from "@/components/FileCategorySelect";
import type { ScannedGameFile } from "@shared/schema";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const gameId = "game-1";
const file: ScannedGameFile = {
  name: "Game.Update.2.zip",
  path: "/library/Game/Game.Update.2.zip",
  category: "update",
  size: 10,
};

function renderSelect() {
  const client = createTestQueryClient();
  client.setQueryData([`/api/games/${gameId}/files`], [file]);
  render(
    <QueryClientProvider client={client}>
      <FileCategorySelect gameId={gameId} file={file} />
    </QueryClientProvider>
  );
  return client;
}

async function pick(label: string) {
  const trigger = screen.getByRole("combobox", { name: `Category for ${file.name}` });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("FileCategorySelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the scanned category", () => {
    renderSelect();
    expect(screen.getByRole("combobox", { name: `Category for ${file.name}` })).toHaveTextContent(
      "Update"
    );
  });

  it("saves the new category and updates the cached file list", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ path: file.path, category: "dlc" }) });
    const client = renderSelect();

    await pick("DLC");

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", `/api/games/${gameId}/files/category`, {
        path: file.path,
        category: "dlc",
      })
    );
    await waitFor(() =>
      expect(client.getQueryData([`/api/games/${gameId}/files`])).toEqual([
        { ...file, category: "dlc" },
      ])
    );
  });

  it("tells the user when saving fails", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    renderSelect();

    await pick("Main game");

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Could not change the category", variant: "destructive" })
      )
    );
  });
});
