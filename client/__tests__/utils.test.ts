import { z } from "zod";
import { describe, it, expect } from "vitest";
import {
  asZodType,
  compareEnabledPriorityName,
  formatBytes,
  isDiscoveryId,
  mapGameToInsertGame,
  parseReleaseDate,
  safeUrl,
} from "../src/lib/utils";

describe("safeUrl", () => {
  it("should return the original URL if it uses http protocol", () => {
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });

  it("should return the original URL if it uses https protocol", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
  });

  it("should resolve missing protocol URLs against the window location if they don't have a protocol", () => {
    // In vitest's JSDOM environment, window.location.origin is typically http://localhost:3000 or similar
    // We expect valid paths to be treated as safe
    const result = safeUrl("/some/path");
    expect(result).toBe("/some/path");
  });

  it("should return the fallback URL if it uses javascript protocol", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
  });

  it("should return the fallback URL if it uses data protocol", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("should return the fallback URL if it uses vbscript protocol", () => {
    expect(safeUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("should return a custom fallback URL if provided", () => {
    expect(safeUrl("javascript:alert(1)", "/safe")).toBe("/safe");
  });

  it("should block javascript pseudo-protocol with spaces", () => {
    expect(safeUrl("  javascript:alert(1)  ")).toBe("#");
  });
});

describe("formatBytes", () => {
  it("formats zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats larger byte counts using the correct unit", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});

describe("asZodType", () => {
  it("returns the provided schema with the same parsing behavior", () => {
    const schema = z.object({ name: z.string() });
    const typedSchema = asZodType<{ name: string }>(schema);
    expect(typedSchema.parse({ name: "Questarr" })).toEqual({ name: "Questarr" });
  });
});

describe("isDiscoveryId", () => {
  it("accepts igdb-prefixed string ids only", () => {
    expect(isDiscoveryId("igdb-123")).toBe(true);
    expect(isDiscoveryId("123")).toBe(false);
    expect(isDiscoveryId(123)).toBe(false);
  });
});

describe("mapGameToInsertGame", () => {
  it("maps only insertable fields and normalizes booleans", () => {
    const mapped = mapGameToInsertGame({
      id: "game-1",
      igdbId: 77,
      title: "Questarr",
      summary: "Summary",
      coverUrl: "/cover.png",
      releaseDate: "",
      rating: 9,
      platforms: ["PC"],
      genres: ["Action"],
      screenshots: ["shot"],
      igdbWebsites: ["site"],
      aggregatedRating: 88,
      source: "api",
      status: "wanted",
      hidden: undefined,
      isAdultContent: undefined,
      earlyAccess: undefined,
    });

    expect(mapped).toEqual({
      igdbId: 77,
      title: "Questarr",
      summary: "Summary",
      coverUrl: "/cover.png",
      releaseDate: null,
      rating: 9,
      platforms: ["PC"],
      genres: ["Action"],
      themes: undefined,
      screenshots: ["shot"],
      igdbWebsites: ["site"],
      aggregatedRating: 88,
      source: "api",
      status: "wanted",
      hidden: false,
      isAdultContent: false,
      earlyAccess: false,
    });
  });
});

describe("compareEnabledPriorityName", () => {
  it("sorts by enabled state, then priority, then name case-insensitively", () => {
    const items = [
      { enabled: false, priority: 1, name: "Beta" },
      { enabled: true, priority: 2, name: "Zulu" },
      { enabled: true, priority: 1, name: "alpha" },
      { enabled: true, priority: 1, name: "Bravo" },
    ];

    expect(items.sort(compareEnabledPriorityName).map((item) => item.name)).toEqual([
      "alpha",
      "Bravo",
      "Zulu",
      "Beta",
    ]);
  });
});

describe("parseReleaseDate", () => {
  it("returns TBA for missing values", () => {
    expect(parseReleaseDate(null)).toEqual({ year: "TBA", fullDate: null });
  });

  it("treats year-only sentinel dates as year with no full date", () => {
    expect(parseReleaseDate("2024-12-31")).toEqual({ year: "2024", fullDate: null });
  });

  it("falls back to year-only when the date is invalid", () => {
    expect(parseReleaseDate("2024-not-a-date")).toEqual({ year: "2024", fullDate: null });
  });

  it("formats a valid full date in UTC", () => {
    expect(parseReleaseDate("2024-02-03T00:00:00.000Z")).toEqual({
      year: "2024",
      fullDate: "03/02/2024",
    });
  });
});
