/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import InstalledVersionField, { getVersionSuggestions } from "@/components/InstalledVersionField";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const gameId = "game-1";

function renderField(installedVersion: string | null, releaseNames: string[] = []) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <InstalledVersionField
        gameId={gameId}
        installedVersion={installedVersion}
        releaseNames={releaseNames}
      />
    </QueryClientProvider>
  );
  return screen.getByLabelText("Installed version");
}

describe("getVersionSuggestions", () => {
  it("lists distinct versions newest first, without the current one", () => {
    expect(
      getVersionSuggestions(
        [
          "Game.v1.2-RUNE",
          "Game.Update.v1.10-RUNE",
          "Game.v1.2-GOG",
          "Game.Update.v1.3-RUNE",
          "Game-NoVersion",
        ],
        "v1.3"
      )
    ).toEqual(["v1.10", "v1.2"]);
  });
});

describe("InstalledVersionField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the stored version", () => {
    expect(renderField("v1.2.3")).toHaveValue("v1.2.3");
  });

  it("saves the typed version on Enter", async () => {
    const input = renderField(null);
    fireEvent.change(input, { target: { value: " v2.0 " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", `/api/games/${gameId}/installed-version`, {
        installedVersion: "v2.0",
      })
    );
  });

  it("clears the version when emptied and blurred", async () => {
    const input = renderField("v1.0");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", `/api/games/${gameId}/installed-version`, {
        installedVersion: null,
      })
    );
  });

  it("does not save when the value did not change", () => {
    const input = renderField("v1.0");
    fireEvent.blur(input);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("applies a suggestion from the game's downloads", async () => {
    renderField(null, ["Game.Update.v1.4-RUNE"]);
    fireEvent.click(screen.getByRole("button", { name: "Set installed version to v1.4" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", `/api/games/${gameId}/installed-version`, {
        installedVersion: "v1.4",
      })
    );
  });

  it("restores the stored value and warns when saving fails", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    const input = renderField("v1.0");
    fireEvent.change(input, { target: { value: "v9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(input).toHaveValue("v1.0");
  });
});
