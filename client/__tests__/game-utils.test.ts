/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { getReleaseStatus } from "../src/lib/game-utils";
import type { Game } from "@shared/schema";

const baseGame = {
  id: "1",
  title: "Test Game",
  coverUrl: "http://example.com/cover.jpg",
  status: "wanted",
  releaseDate: "2023-01-01",
  rating: 8.5,
  genres: ["Action"],
  summary: "Test summary",
  releaseStatus: "released",
  hidden: false,
  folderName: "Test Game",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Game;

describe("getReleaseStatus", () => {
  it("returns Delayed when releaseStatus is delayed", () => {
    const game = { ...baseGame, releaseStatus: "delayed" } as unknown as Game;
    const result = getReleaseStatus(game);
    expect(result).toEqual({ label: "Delayed", variant: "destructive", isReleased: false });
  });

  it("returns TBA when no releaseDate", () => {
    const game = { ...baseGame, releaseDate: null, releaseStatus: null } as unknown as Game;
    const result = getReleaseStatus(game);
    expect(result).toEqual({ label: "TBA", variant: "secondary", isReleased: false });
  });

  it("returns Upcoming for a future release date", () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const game = {
      ...baseGame,
      releaseDate: futureDate.toISOString().split("T")[0],
      releaseStatus: null,
    } as unknown as Game;
    const result = getReleaseStatus(game);
    expect(result).toEqual({ label: "Upcoming", variant: "default", isReleased: false });
  });

  it("returns Released with green styling for a past release date", () => {
    const pastDate = new Date();
    pastDate.setFullYear(pastDate.getFullYear() - 1);
    const game = {
      ...baseGame,
      releaseDate: pastDate.toISOString().split("T")[0],
      releaseStatus: null,
    } as unknown as Game;
    const result = getReleaseStatus(game);
    expect(result).toEqual({
      label: "Released",
      variant: "outline",
      isReleased: true,
      className: "bg-green-500 border-green-600 text-white",
    });
  });
});
