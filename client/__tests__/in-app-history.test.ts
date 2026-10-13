/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { canGoBackInApp } from "../src/lib/in-app-history";

describe("canGoBackInApp", () => {
  it("is false until the app pushes a history entry itself", () => {
    expect(canGoBackInApp()).toBe(false);
    window.history.pushState({}, "", "/games/g1");
    expect(canGoBackInApp()).toBe(true);
  });
});
