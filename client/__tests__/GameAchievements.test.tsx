/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GameAchievements from "../src/components/GameAchievements";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

const GAME_ID = "game-1";

const ACHIEVEMENTS = [
  {
    apiName: "WIN",
    displayName: "Beat the game",
    description: "Finish the story",
    icon: "https://cdn.example/win.png",
    iconGray: "https://cdn.example/win-gray.png",
    hidden: false,
    achieved: true,
    unlockedAt: 1_700_000_000_000,
    globalPercent: 42.345,
  },
  {
    apiName: "SECRET",
    displayName: "Hidden path",
    description: null,
    icon: "https://cdn.example/secret.png",
    iconGray: "https://cdn.example/secret-gray.png",
    hidden: true,
    achieved: false,
    unlockedAt: null,
    globalPercent: null,
  },
];

let response: { status: number; body: unknown };

beforeEach(() => {
  response = { status: 200, body: { achievements: ACHIEVEMENTS } };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    expect(getRequestUrl(input)).toBe(`/api/games/${GAME_ID}/achievements`);
    return {
      ok: response.status < 400,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
      clone() {
        return this;
      },
    } as Response;
  });
});

function renderSection() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <GameAchievements gameId={GAME_ID} />
    </QueryClientProvider>
  );
}

describe("GameAchievements", () => {
  it("lists achievements with the unlocked count, rarity, unlock state and locked icons", async () => {
    const { container } = renderSection();

    expect(await screen.findByText("Beat the game")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText(/unlocked \(50%\)/)).toBeInTheDocument();
    expect(screen.getByText("Finish the story")).toBeInTheDocument();
    expect(screen.getByText(/42\.3% of players/)).toBeInTheDocument();
    expect(screen.getByText(/^Unlocked /)).toBeInTheDocument();
    expect(screen.getByText("Hidden achievement")).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("Locked")).toBeInTheDocument();

    const icons = Array.from(container.querySelectorAll("img")).map((img) =>
      img.getAttribute("src")
    );
    expect(icons).toContain("https://cdn.example/win.png");
    expect(icons).toContain("https://cdn.example/secret-gray.png");
    expect(icons).not.toContain("https://cdn.example/secret.png");
  });

  it("filters by unlocked and locked", async () => {
    renderSection();
    await screen.findByText("Beat the game");

    fireEvent.click(screen.getByRole("radio", { name: "Show locked" }));
    expect(screen.queryByText("Beat the game")).not.toBeInTheDocument();
    expect(screen.getByText("Hidden path")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Show unlocked" }));
    expect(screen.getByText("Beat the game")).toBeInTheDocument();
    expect(screen.queryByText("Hidden path")).not.toBeInTheDocument();
  });

  it.each([
    ["no_steam_id", /Save your Steam ID in Settings/, true],
    ["not_configured", /Add a Steam Web API key in Settings/, true],
    ["private", /Game details to public/, false],
    ["no_steam_app_id", /not linked to a Steam app/, false],
  ])("explains why nothing is shown (%s)", async (reason, text, hasLink) => {
    response = { status: 200, body: { achievements: [], reason } };
    renderSection();

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Settings" }) !== null).toBe(hasLink);
  });

  it("says when the game has no achievements", async () => {
    response = { status: 200, body: { achievements: [] } };
    renderSection();

    expect(await screen.findByText("This game has no Steam achievements.")).toBeInTheDocument();
  });

  it("offers a retry when loading fails", async () => {
    response = { status: 500, body: { error: "boom" } };
    renderSection();

    expect(await screen.findByText("Could not load the achievements.")).toBeInTheDocument();
    response = { status: 200, body: { achievements: ACHIEVEMENTS } };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Beat the game")).toBeInTheDocument();
  });
});
