import { describe, it, expect } from "vitest";
import { normalizeDownloadHash, normalizeTrackedKey } from "../download-hash.js";

describe("normalizeDownloadHash", () => {
  it("lowercases a 40-char hex v1 torrent hash", () => {
    expect(normalizeDownloadHash("ABCDEF0123456789ABCDEF0123456789ABCDEF01")).toBe(
      "abcdef0123456789abcdef0123456789abcdef01"
    );
  });

  it("lowercases a 64-char hex v2 torrent hash", () => {
    const upper = "A".repeat(64);
    expect(normalizeDownloadHash(upper)).toBe("a".repeat(64));
  });

  it("leaves a mixed-case SABnzbd nzo_id untouched", () => {
    expect(normalizeDownloadHash("SABnzbd_nzo_AbCdEf")).toBe("SABnzbd_nzo_AbCdEf");
  });

  it("leaves a mixed-case correlation tag untouched", () => {
    expect(normalizeDownloadHash("questarr-add-AbC123")).toBe("questarr-add-AbC123");
  });

  it("leaves a non-40/64-char string that merely looks hex-ish untouched", () => {
    expect(normalizeDownloadHash("ABCDEF")).toBe("ABCDEF");
  });
});

describe("normalizeTrackedKey", () => {
  it("lowercases the hash portion when it is a torrent hash", () => {
    const hash = "A".repeat(40);
    expect(normalizeTrackedKey(`dl-1:${hash}`)).toBe(`dl-1:${hash.toLowerCase()}`);
  });

  it("preserves case of a mixed-case Usenet id after the downloader-id prefix", () => {
    expect(normalizeTrackedKey("dl-1:SABnzbd_nzo_AbCdEf")).toBe("dl-1:SABnzbd_nzo_AbCdEf");
  });

  it("returns the key unchanged when there is no colon separator", () => {
    expect(normalizeTrackedKey("no-separator")).toBe("no-separator");
  });
});
