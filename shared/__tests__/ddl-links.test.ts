import { describe, expect, it } from "vitest";
import { extractHosterLinks, safeDdlFileName } from "../ddl-links.js";

describe("extractHosterLinks", () => {
  it("reads one link per line and removes duplicates, keeping order", () => {
    const text = [
      "https://example.com/f/abc/game.part1.rar",
      "https://example.com/f/def/game.part2.rar",
      "https://example.com/f/abc/game.part1.rar",
    ].join("\n");
    expect(extractHosterLinks(text)).toEqual([
      "https://example.com/f/abc/game.part1.rar",
      "https://example.com/f/def/game.part2.rar",
    ]);
  });

  it("finds links inside a post, BBCode and HTML", () => {
    const text =
      'Download: [url]https://example.com/a[/url] or <a href="https://example.com/b?x=1&amp;y=2">b</a>. ' +
      "Mirror (https://example.com/c), done!";
    expect(extractHosterLinks(text)).toEqual([
      "https://example.com/a",
      "https://example.com/b?x=1&y=2",
      "https://example.com/c",
    ]);
  });

  it("ignores text without links and non-http schemes", () => {
    expect(extractHosterLinks("nothing here ftp://example.com/x magnet:?xt=urn:btih:1")).toEqual(
      []
    );
  });
});

describe("safeDdlFileName", () => {
  it("strips separators and falls back when nothing is left", () => {
    expect(safeDdlFileName("a/b\\c:d.rar", "part-1")).toBe("a_b_c_d.rar");
    expect(safeDdlFileName("..", "part-2")).toBe("part-2");
    expect(safeDdlFileName("  ", "part-3")).toBe("part-3");
  });
});
