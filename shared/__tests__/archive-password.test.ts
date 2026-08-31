import { describe, expect, it } from "vitest";
import { getArchivePasswordSetting, resolveArchivePassword } from "@shared/archive-password";

describe("getArchivePasswordSetting", () => {
  it("returns the stored archive password", () => {
    expect(getArchivePasswordSetting(JSON.stringify({ archivePassword: "404" }))).toBe("404");
  });

  it("returns undefined when settings JSON has no archivePassword", () => {
    expect(getArchivePasswordSetting(JSON.stringify({ initialState: "stopped" }))).toBeUndefined();
  });

  it("returns undefined for missing settings", () => {
    expect(getArchivePasswordSetting(undefined)).toBeUndefined();
  });
});

describe("resolveArchivePassword", () => {
  it("prefers the per-request password over the configured default", () => {
    expect(
      resolveArchivePassword(
        "override",
        JSON.stringify({ archivePassword: "default" }),
        "https://example.com",
        "SABnzbd"
      )
    ).toEqual({ password: "override" });
  });

  it("falls back to the downloader's configured default", () => {
    expect(
      resolveArchivePassword(
        undefined,
        JSON.stringify({ archivePassword: "404" }),
        "https://example.com",
        "NZBGet"
      )
    ).toEqual({ password: "404" });
  });

  it("resolves to no password when neither is set", () => {
    expect(resolveArchivePassword(undefined, undefined, "https://example.com", "SABnzbd")).toEqual(
      {}
    );
  });

  it("refuses to send a password over plain HTTP, naming the downloader type", () => {
    const result = resolveArchivePassword("404", undefined, "http://example.com", "NZBGet");
    expect(result.password).toBeUndefined();
    expect(result.error).toContain("NZBGet");
  });

  it("allows a plain-HTTP connection when no password is being sent", () => {
    expect(resolveArchivePassword(undefined, undefined, "http://example.com", "SABnzbd")).toEqual(
      {}
    );
  });
});
