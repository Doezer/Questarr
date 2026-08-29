import { describe, expect, it } from "vitest";
import { parseJsonObject } from "../json-object-utils.js";

describe("parseJsonObject", () => {
  it("parses a plain object", () => {
    expect(parseJsonObject(JSON.stringify({ a: 1, b: "two" }))).toEqual({ a: 1, b: "two" });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["malformed JSON", "not-json"],
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON array with content", '["a","b"]'],
    ["a JSON number", "42"],
    ["a JSON string", '"hello"'],
    ["a JSON boolean", "true"],
  ])("returns {} for %s", (_label, input) => {
    expect(parseJsonObject(input)).toEqual({});
  });
});
