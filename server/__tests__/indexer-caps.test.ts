import { describe, it, expect } from "vitest";
import { indexerAllowsApiKey } from "../indexer-caps.js";

describe("indexerAllowsApiKey", () => {
  it("allows the key for an HTTPS indexer regardless of allowInsecureLan", () => {
    expect(indexerAllowsApiKey({ url: "https://indexer.example", allowInsecureLan: false })).toBe(
      true
    );
    expect(indexerAllowsApiKey({ url: "https://indexer.example", allowInsecureLan: true })).toBe(
      true
    );
  });

  it("denies the key for an HTTP indexer without the insecure-LAN opt-in", () => {
    expect(indexerAllowsApiKey({ url: "http://indexer.example", allowInsecureLan: false })).toBe(
      false
    );
  });

  it("allows the key for an HTTP indexer with the insecure-LAN opt-in", () => {
    expect(indexerAllowsApiKey({ url: "http://indexer.example", allowInsecureLan: true })).toBe(
      true
    );
  });

  it("denies the key for a non-HTTP(S) scheme even with the insecure-LAN opt-in", () => {
    expect(indexerAllowsApiKey({ url: "ftp://indexer.example", allowInsecureLan: true })).toBe(
      false
    );
  });

  it("denies the key for a malformed URL", () => {
    expect(indexerAllowsApiKey({ url: "not a url", allowInsecureLan: true })).toBe(false);
  });
});
