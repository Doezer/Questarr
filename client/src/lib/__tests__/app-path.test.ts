/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { normalizeBasePath, resolveBasePathFrom, withBasePathFrom } from "@/lib/app-path";

describe("app path helpers", () => {
  it("normalizes configured base paths to leading and trailing slashes", () => {
    expect(normalizeBasePath("questarr")).toBe("/questarr/");
    expect(normalizeBasePath("/questarr")).toBe("/questarr/");
    expect(normalizeBasePath("/questarr/")).toBe("/questarr/");
    expect(normalizeBasePath("./")).toBe("/");
  });

  it("resolves relative Vite bases against the current browser location", () => {
    expect(resolveBasePathFrom("./", "https://example.com/")).toBe("/");
    expect(resolveBasePathFrom("./", "https://example.com/questarr")).toBe("/questarr/");
    expect(resolveBasePathFrom("./", "https://example.com/questarr/")).toBe("/questarr/");
    expect(resolveBasePathFrom("./", "https://example.com/questarr/search")).toBe("/questarr/");
  });

  it("prefers the loaded module asset path for relative bases on unknown routes", () => {
    expect(
      resolveBasePathFrom(
        "./",
        "https://example.com/questarr/typo",
        "https://example.com/questarr/assets/index-abc123.js"
      )
    ).toBe("/questarr/");
    expect(
      resolveBasePathFrom(
        "./",
        "https://example.com/questarr/typo",
        "https://example.com/questarr/src/main.tsx"
      )
    ).toBe("/questarr/");
  });

  it("falls back to the parent path for unknown routes when no asset hint is available", () => {
    expect(resolveBasePathFrom("./", "https://example.com/questarr/typo")).toBe("/questarr/");
    expect(resolveBasePathFrom("./", "https://example.com/typo")).toBe("/");
  });

  it("prefixes app-relative URLs without touching absolute ones", () => {
    expect(withBasePathFrom("/questarr/", "/api/games")).toBe("/questarr/api/games");
    expect(withBasePathFrom("/questarr/", "Questarr.svg")).toBe("/questarr/Questarr.svg");
    expect(withBasePathFrom("/questarr/", "/")).toBe("/questarr/");
    expect(withBasePathFrom("/questarr/", "https://example.com/file")).toBe(
      "https://example.com/file"
    );
  });
});
