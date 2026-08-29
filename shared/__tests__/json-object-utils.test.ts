import { describe, expect, it } from "vitest";
import { parseJsonObject } from "../json-object-utils.js";

describe("parseJsonObject", () => {
  it("parses a plain object", () => {
    expect(parseJsonObject(JSON.stringify({ a: 1, b: "two" }))).toEqual({ a: 1, b: "two" });
  });

  it("returns {} for null, undefined, and empty string", () => {
    expect(parseJsonObject(null)).toEqual({});
    expect(parseJsonObject(undefined)).toEqual({});
    expect(parseJsonObject("")).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(parseJsonObject("not-json")).toEqual({});
  });

  it("returns {} for JSON that parses to null or an array", () => {
    expect(parseJsonObject("null")).toEqual({});
    expect(parseJsonObject("[]")).toEqual({});
    expect(parseJsonObject('["a","b"]')).toEqual({});
  });

  it("returns {} for JSON primitives", () => {
    expect(parseJsonObject("42")).toEqual({});
    expect(parseJsonObject('"hello"')).toEqual({});
    expect(parseJsonObject("true")).toEqual({});
  });
});
