import { describe, it, expect } from "vitest";
import { indexerAllowsApiKey } from "../indexer-caps.js";

describe("indexerAllowsApiKey", () => {
  it.each([
    [
      "allows the key for an HTTPS indexer without the insecure-LAN opt-in",
      "https://indexer.example",
      false,
      true,
    ],
    [
      "allows the key for an HTTPS indexer with the insecure-LAN opt-in",
      "https://indexer.example",
      true,
      true,
    ],
    [
      "denies the key for an HTTP indexer without the insecure-LAN opt-in",
      "http://indexer.example",
      false,
      false,
    ],
    [
      "allows the key for an HTTP indexer with the insecure-LAN opt-in",
      "http://indexer.example",
      true,
      true,
    ],
    [
      "denies the key for a non-HTTP(S) scheme even with the insecure-LAN opt-in",
      "ftp://indexer.example",
      true,
      false,
    ],
    ["denies the key for a malformed URL", "not a url", true, false],
  ] as const)("%s", (_label, url, allowInsecureLan, expected) => {
    expect(indexerAllowsApiKey({ url, allowInsecureLan })).toBe(expected);
  });
});
