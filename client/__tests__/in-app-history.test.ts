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
  const back = () =>
    new Promise<void>((resolve) => {
      window.addEventListener("popstate", () => resolve(), { once: true });
      window.history.back();
    });

  it("restores only when coming Back to the entry a game was opened from", async () => {
    window.history.pushState({}, "", "/library");
    saveListState("library", { searchQuery: "zelda" });
    expect(restoredListState("library")).toBeUndefined();

    // library -> game -> discover -> game: each list entry keeps its own flag.
    window.history.pushState({}, "", "/games/g1");
    window.history.pushState({}, "", "/discover");
    window.history.pushState({}, "", "/games/igdb-77");
    await back();
    await back();
    await back();
    expect(window.location.pathname).toBe("/library");
    expect(restoredListState("library")).toEqual({ searchQuery: "zelda" });

    window.history.pushState({}, "", "/library");
    expect(restoredListState("library")).toBeUndefined();
  });

  it("gives each entry its own snapshot", async () => {
    window.history.pushState({}, "", "/library");
    saveListState("library", { searchQuery: "zelda" });
    window.history.pushState({}, "", "/games/g1");
    window.history.pushState({}, "", "/library");
    saveListState("library", { searchQuery: "mario" });
    window.history.pushState({}, "", "/games/g2");
    await back();
    expect(restoredListState("library")).toEqual({ searchQuery: "mario" });
    await back();
    await back();
    expect(window.location.pathname).toBe("/library");
    expect(restoredListState("library")).toEqual({ searchQuery: "zelda" });
  });
});
