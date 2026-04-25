import { describe, it, expect } from "vitest";
import { getNextStatusLabel, safeUrl } from "../src/lib/utils";

describe("safeUrl", () => {
  it("should return the original URL if it uses http protocol", () => {
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });

  it("should return the original URL if it uses https protocol", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
  });

  it("should resolve missing protocol URLs against the window location if they don't have a protocol", () => {
    // In vitest's JSDOM environment, window.location.origin is typically http://localhost:3000 or similar
    // We expect valid paths to be treated as safe
    const result = safeUrl("/some/path");
    expect(result).toBe("/some/path");
  });

  it("should return the fallback URL if it uses javascript protocol", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
  });

  it("should return the fallback URL if it uses data protocol", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
  });

  it("should return the fallback URL if it uses vbscript protocol", () => {
    expect(safeUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("should return a custom fallback URL if provided", () => {
    expect(safeUrl("javascript:alert(1)", "/safe")).toBe("/safe");
  });

  it("should block javascript pseudo-protocol with spaces", () => {
    expect(safeUrl("  javascript:alert(1)  ")).toBe("#");
  });
});

describe("getNextStatusLabel", () => {
  it("returns Owned when current status is wanted", () => {
    expect(getNextStatusLabel("wanted")).toBe("Owned");
  });

  it("returns Completed when current status is owned", () => {
    expect(getNextStatusLabel("owned")).toBe("Completed");
  });

  it("returns Wanted when current status is completed", () => {
    expect(getNextStatusLabel("completed")).toBe("Wanted");
  });
});
