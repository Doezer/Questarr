import { describe, it, expect } from "vitest";
import {
  indexerAllowsApiKey,
  resolveSearchCategories,
  withheldApiKeyHint,
} from "../indexer-caps.js";

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

describe("resolveSearchCategories", () => {
  it("defaults to the standard game categories when nothing is configured or requested", () => {
    expect(resolveSearchCategories(undefined, undefined)).toEqual(["4000", "1000"]);
    expect(resolveSearchCategories([], [])).toEqual(["4000", "1000"]);
  });

  it("uses the indexer's configured categories as-is when none are requested", () => {
    expect(resolveSearchCategories(undefined, ["4000", "1000"])).toEqual(["4000", "1000"]);
  });

  it("sends a mixed list of configured categories unfiltered", () => {
    expect(resolveSearchCategories(undefined, ["4000", "8000"])).toEqual(["4000", "8000"]);
  });

  it("sends a configured custom category ID unfiltered", () => {
    expect(resolveSearchCategories(undefined, ["8000"])).toEqual(["8000"]);
  });

  it("prefers explicit request categories over configured ones", () => {
    expect(resolveSearchCategories(["2000"], ["4000", "1000"])).toEqual(["2000"]);
  });
});

describe("withheldApiKeyHint", () => {
  const lanIndexer = { url: "http://192.168.1.10:9696/1/api", apiKey: "key" };

  it("explains a 401 caused by withholding the key over plain HTTP", () => {
    expect(withheldApiKeyHint({ ...lanIndexer, allowInsecureLan: false }, 401)).toContain(
      "Allow insecure LAN connection"
    );
    expect(withheldApiKeyHint({ ...lanIndexer, allowInsecureLan: false }, 403)).not.toBe("");
  });

  it("stays silent when the key was actually sent or the failure is not auth", () => {
    expect(withheldApiKeyHint({ ...lanIndexer, allowInsecureLan: true }, 401)).toBe("");
    expect(
      withheldApiKeyHint(
        { ...lanIndexer, url: "https://idx.example.com/api", allowInsecureLan: false },
        401
      )
    ).toBe("");
    expect(withheldApiKeyHint({ ...lanIndexer, allowInsecureLan: false }, 500)).toBe("");
    expect(withheldApiKeyHint({ ...lanIndexer, apiKey: "", allowInsecureLan: false }, 401)).toBe(
      ""
    );
  });
});
