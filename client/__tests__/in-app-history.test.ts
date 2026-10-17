/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { canGoBackInApp } from "../src/lib/in-app-history";

describe("canGoBackInApp", () => {
  it("is true only on entries the app pushed itself", () => {
    expect(canGoBackInApp()).toBe(false);
    window.history.pushState({ game: "g1" }, "", "/games/g1");
    expect(canGoBackInApp()).toBe(true);
    expect(window.history.state).toMatchObject({ game: "g1" });
    window.history.replaceState(null, "", "/games/g2");
    expect(canGoBackInApp()).toBe(true);
  });
});
