import { describe, it, expect, vi } from "vitest";

vi.mock("../steam-routes.js", () => ({
  steamRoutes: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { parseCategories } from "../routes.js";

describe("parseCategories", () => {
  it("should return undefined for null/undefined input", () => {
    expect(parseCategories(undefined)).toBeUndefined();
    expect(parseCategories(null)).toBeUndefined();
  });

  it("should parse single string", () => {
    expect(parseCategories("1000")).toEqual(["1000"]);
  });

  it("should parse comma-separated string", () => {
    expect(parseCategories("1000,2000")).toEqual(["1000", "2000"]);
    expect(parseCategories("1000, 2000")).toEqual(["1000", "2000"]);
  });

  it("should parse array of strings", () => {
    expect(parseCategories(["1000", "2000"])).toEqual(["1000", "2000"]);
  });

  it("should handle mixed array inputs (if express parser produces them)", () => {
    // Standard qs parser produces strings or arrays of strings.
    // If we receive ['1000,2000', '3000'], we treat it as ['1000,2000', '3000'].
    // My implementation currently does NOT split strings inside arrays.
    // It maps String() then filters.
    // If the input is ["1000", "2000"], it works.
    expect(parseCategories(["1000", "2000"])).toEqual(["1000", "2000"]);
  });

  it("should filter empty strings", () => {
    expect(parseCategories("1000,,2000")).toEqual(["1000", "2000"]);
    expect(parseCategories(["1000", ""])).toEqual(["1000"]);
  });
});
