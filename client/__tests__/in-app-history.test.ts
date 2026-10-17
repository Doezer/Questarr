/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { canGoBackInApp, restoredListState, saveListState } from "../src/lib/in-app-history";

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

describe("list state restore", () => {
  it("restores only when coming Back from a game opened from that list", () => {
    window.history.replaceState(null, "", "/library");
    saveListState("library", { searchQuery: "zelda" });
    expect(restoredListState("library")).toBeUndefined();

    window.history.pushState({}, "", "/games/g1");
    window.history.replaceState(null, "", "/library");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(restoredListState("library")).toEqual({ searchQuery: "zelda" });

    window.history.pushState({}, "", "/library");
    expect(restoredListState("library")).toBeUndefined();
  });
});
