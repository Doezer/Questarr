import { describe, expect, it } from "vitest";
import { loginDestination } from "../src/lib/login-destination";

describe("login destination", () => {
  it("preserves a local path, query and anchor", () => {
    const path = "/settings?tab=discovery#classification-review";
    expect(loginDestination(`next=${encodeURIComponent(path)}`)).toBe(path);
  });

  it.each([
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/login",
    "/login/",
    "/login/?next=%2Fgames%2Fgame-1",
    "/setup",
    "/setup/",
    "/games/../login",
    "/\n/evil.example",
  ])("safely handles destination %s", (path) => {
    const result = loginDestination(`next=${encodeURIComponent(path)}`);
    expect(result).toBe("/");
  });
});
