import { describe, expect, it } from "vitest";
import { loginDestination } from "../src/lib/login-destination";
import { authRoute } from "../src/lib/routes";

describe("login destination", () => {
  it("does not decode router paths a second time", () => {
    expect(authRoute("/%6cogin")).toBeNull();
    expect(authRoute("/LoGiN/")).toBe("login");
    expect(authRoute("/SETUP")).toBe("setup");
  });
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
    "/LOGIN",
    "/LoGiN/",
    "/log%69n/",
    "/login/?next=%2Fgames%2Fgame-1",
    "/setup",
    "/setup/",
    "/SETUP/",
    "/games/../login",
    "/\n/evil.example",
  ])("safely handles destination %s", (path) => {
    const result = loginDestination(`next=${encodeURIComponent(path)}`);
    expect(result).toBe("/");
  });

  it("decodes next only once and retains encoded query values", () => {
    const path = "/settings?tab=import&note=A%26B&literal=%252F#context";
    expect(loginDestination(`?next=${encodeURIComponent(path)}`)).toBe(path);
  });
});
