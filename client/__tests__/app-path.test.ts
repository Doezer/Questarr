/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { normalizeBasePath, resolveBasePathFrom, withBasePathFrom } from "../src/lib/app-path";

// ─── normalizeBasePath ────────────────────────────────────────────────────────

describe("normalizeBasePath", () => {
  it('returns "/" for empty string', () => {
    expect(normalizeBasePath("")).toBe("/");
  });

  it('returns "/" for "."', () => {
    expect(normalizeBasePath(".")).toBe("/");
  });

  it('returns "/" for "./"', () => {
    expect(normalizeBasePath("./")).toBe("/");
  });

  it("adds leading and trailing slash to a bare segment", () => {
    expect(normalizeBasePath("questarr")).toBe("/questarr/");
  });

  it("adds trailing slash when leading slash is already present", () => {
    expect(normalizeBasePath("/questarr")).toBe("/questarr/");
  });

  it("preserves a path that already has both slashes", () => {
    expect(normalizeBasePath("/questarr/")).toBe("/questarr/");
  });
});

// ─── resolveBasePathFrom — relative base (./) ────────────────────────────────

describe("resolveBasePathFrom — relative base (./)", () => {
  const BASE = "./";

  it('returns "/" when both currentHref and runtimeAssetHref are absent', () => {
    expect(resolveBasePathFrom(BASE)).toBe("/");
  });

  // resolveBasePathFromRuntimeAsset — dev entry path
  it("resolves base from a dev-server script URL containing /src/main.tsx", () => {
    const assetHref = "http://localhost:5000/questarr/src/main.tsx";
    expect(resolveBasePathFrom(BASE, undefined, assetHref)).toBe("/questarr/");
  });

  // resolveBasePathFromRuntimeAsset — production /assets/ segment
  it("resolves base from a production asset URL containing /assets/", () => {
    const assetHref = "http://localhost/questarr/assets/index-abc.js";
    expect(resolveBasePathFrom(BASE, undefined, assetHref)).toBe("/questarr/");
  });

  // resolveBasePathFromRuntimeAsset — root-level asset (no sub-path)
  it('returns "/" when the asset URL sits at the document root', () => {
    const assetHref = "http://localhost/assets/index-abc.js";
    expect(resolveBasePathFrom(BASE, undefined, assetHref)).toBe("/");
  });

  // resolveBasePathFromRuntimeAsset — valid URL that matches neither pattern → undefined (line 40)
  it("falls through to currentHref when asset URL matches no known pattern", () => {
    const assetHref = "http://localhost/favicon.ico";
    // no currentHref → returns "/"
    expect(resolveBasePathFrom(BASE, undefined, assetHref)).toBe("/");
  });

  // resolveBasePathFromRuntimeAsset — invalid URL → catch → undefined
  it("falls through to currentHref when asset URL is malformed", () => {
    expect(resolveBasePathFrom(BASE, undefined, "not-a-url")).toBe("/");
  });

  // runtimeAssetHref wins over currentHref
  it("prefers runtimeAssetHref over currentHref", () => {
    const assetHref = "http://localhost/base/assets/index.js";
    const href = "http://localhost/other/settings";
    expect(resolveBasePathFrom(BASE, href, assetHref)).toBe("/base/");
  });

  // findMatchedRoute / known route match
  it("resolves base from currentHref when it matches a known route", () => {
    expect(resolveBasePathFrom(BASE, "http://localhost/questarr/settings")).toBe("/questarr/");
  });

  it("resolves base from currentHref for any known sub-route", () => {
    expect(resolveBasePathFrom(BASE, "http://localhost/questarr/downloads")).toBe("/questarr/");
  });

  // fallback: lastSlashIndex > 0 branch (lines 76-78)
  it("falls back to parent path when URL pathname matches no route and has a parent", () => {
    // "/questarr/typo" → lastSlashIndex at 9 → parentPath = "/questarr"
    expect(resolveBasePathFrom(BASE, "http://localhost/questarr/typo")).toBe("/questarr/");
  });

  // fallback: lastSlashIndex === 0 branch — no meaningful parent
  it('returns "/" when unmatched pathname has no parent segment', () => {
    // "/standalone" → lastSlashIndex = 0 → parentPath = "/"
    expect(resolveBasePathFrom(BASE, "http://localhost/standalone")).toBe("/");
  });

  // inner catch block (line 79-80)
  it('returns "/" on a malformed currentHref', () => {
    expect(resolveBasePathFrom(BASE, "not-a-url")).toBe("/");
  });
});

// ─── resolveBasePathFrom — absolute base ─────────────────────────────────────

describe("resolveBasePathFrom — absolute base", () => {
  it("normalizes an absolute base path when no currentHref is provided", () => {
    expect(resolveBasePathFrom("/questarr")).toBe("/questarr/");
  });

  it("resolves an absolute base path against the currentHref origin", () => {
    expect(resolveBasePathFrom("/questarr", "http://localhost/something")).toBe("/questarr/");
  });

  it("handles a base path that already has a trailing slash", () => {
    expect(resolveBasePathFrom("/questarr/", "http://localhost/page")).toBe("/questarr/");
  });

  // outer catch block (lines 91-92)
  it("falls back to normalizing the raw base when currentHref is malformed", () => {
    expect(resolveBasePathFrom("/questarr", "not-a-url")).toBe("/questarr/");
  });
});

// ─── withBasePathFrom ─────────────────────────────────────────────────────────

describe("withBasePathFrom", () => {
  const BASE = "/questarr/";

  it("returns basePath when path is empty", () => {
    expect(withBasePathFrom(BASE, "")).toBe(BASE);
  });

  it('returns basePath when path is "/"', () => {
    expect(withBasePathFrom(BASE, "/")).toBe(BASE);
  });

  it("passes absolute URLs through unchanged", () => {
    expect(withBasePathFrom(BASE, "https://example.com/foo")).toBe("https://example.com/foo");
  });

  it("passes protocol-relative URLs through unchanged", () => {
    expect(withBasePathFrom(BASE, "//cdn.example.com/lib.js")).toBe("//cdn.example.com/lib.js");
  });

  it("passes hash-only fragments through unchanged", () => {
    expect(withBasePathFrom(BASE, "#section")).toBe("#section");
  });

  it("prepends the base prefix to absolute paths", () => {
    expect(withBasePathFrom(BASE, "/api/games")).toBe("/questarr/api/games");
  });

  it("does not double-prefix a path already starting with the base", () => {
    expect(withBasePathFrom(BASE, "/questarr/api/games")).toBe("/questarr/api/games");
  });

  it("does not double-prefix a path that equals the base prefix exactly", () => {
    expect(withBasePathFrom(BASE, "/questarr")).toBe("/questarr");
  });

  it("appends relative paths after the trailing slash of the base", () => {
    expect(withBasePathFrom(BASE, "relative/path")).toBe("/questarr/relative/path");
  });

  it('prepends correctly when basePath is "/"', () => {
    expect(withBasePathFrom("/", "/api/games")).toBe("/api/games");
  });

  it('does not alter already-absolute paths when basePath is "/"', () => {
    expect(withBasePathFrom("/", "/already/absolute")).toBe("/already/absolute");
  });
});
