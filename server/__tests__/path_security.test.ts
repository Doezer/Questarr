import { describe, expect, it } from "vitest";
import path from "node:path";
import { assertWithinRoots } from "../path-security.js";

describe("assertWithinRoots", () => {
  it("never throws when no roots are configured", () => {
    expect(() => assertWithinRoots("/anywhere/at/all", [], "outside roots")).not.toThrow();
  });

  it("allows a path nested inside a configured root", () => {
    expect(() =>
      assertWithinRoots("/data/downloads/release/game.zip", ["/data/downloads"], "outside roots")
    ).not.toThrow();
  });

  it("allows a path exactly equal to a configured root", () => {
    expect(() =>
      assertWithinRoots("/data/downloads", ["/data/downloads"], "outside roots")
    ).not.toThrow();
  });

  it("allows a path inside any of several configured roots", () => {
    const roots = ["/data/downloads", "/data/incoming"];
    expect(() =>
      assertWithinRoots("/data/incoming/release/game.zip", roots, "outside roots")
    ).not.toThrow();
  });

  it("rejects a path outside every configured root", () => {
    expect(() => assertWithinRoots("/etc/passwd", ["/data/downloads"], "outside roots")).toThrow(
      "outside roots"
    );
  });

  it("rejects a sibling directory that merely shares a name prefix", () => {
    // "/data/downloads-other" is not inside "/data/downloads" — a naive
    // startsWith() string check would wrongly allow this.
    expect(() =>
      assertWithinRoots("/data/downloads-other/game.zip", ["/data/downloads"], "outside roots")
    ).toThrow("outside roots");
  });

  it("rejects a traversal sequence that resolves outside the configured root", () => {
    expect(() =>
      assertWithinRoots(
        path.join("/data/downloads", "..", "..", "etc", "passwd"),
        ["/data/downloads"],
        "outside roots"
      )
    ).toThrow("outside roots");
  });
});
