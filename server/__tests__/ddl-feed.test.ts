import { describe, it, expect, vi, beforeEach } from "vitest";
import Parser from "rss-parser";

const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock("../ssrf.js", () => ({ safeFetch: mocks.safeFetch }));

const { extractItemLinks } = await import("../ddl-feed.js");

const hostList = (domains: string[]) => ({ ok: true, json: async () => domains });

describe("extractItemLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("keeps hoster links, drops the blog's own pages and unsupported hosts", async () => {
    mocks.safeFetch.mockResolvedValue(hostList(["1fichier.com", "rapidgator.net"]));
    const { extractItemLinks: extract } = await import("../ddl-feed.js");
    const links = await extract(
      {
        "content:encoded": `<p><a href="https://blog.example/other">more</a></p>
          <a href="https://1fichier.com/?abc">p1</a>
          <a href="https://rapidgator.net/file/1/game.part1.rar.html">p2</a>
          <a href="https://www.youtube.com/watch?v=1">trailer</a>`,
      },
      "https://blog.example/feed/",
      "https://blog.example/game"
    );
    expect(links).toEqual([
      "https://1fichier.com/?abc",
      "https://rapidgator.net/file/1/game.part1.rar.html",
    ]);
  });

  it("matches subdomains of a supported domain", async () => {
    mocks.safeFetch.mockResolvedValue(hostList(["mega.nz"]));
    const { extractItemLinks: extract } = await import("../ddl-feed.js");
    expect(
      await extract(
        { description: "https://www.mega.nz/file/x" },
        "https://a.b/feed",
        "https://a.b/p"
      )
    ).toEqual(["https://www.mega.nz/file/x"]);
  });

  it("keeps every non-blog link when the host list cannot be read", async () => {
    mocks.safeFetch.mockRejectedValue(new Error("offline"));
    const { extractItemLinks: extract } = await import("../ddl-feed.js");
    expect(
      await extract(
        { content: "https://host.example/f1 https://blog.example/x" },
        "https://blog.example/feed",
        "https://blog.example/x"
      )
    ).toEqual(["https://host.example/f1"]);
  });

  it("finds links in a real parsed RSS item (content:encoded)", async () => {
    mocks.safeFetch.mockResolvedValue(hostList(["1fichier.com"]));
    const { extractItemLinks: extract } = await import("../ddl-feed.js");
    const feed = await new Parser().parseString(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
      <title>t</title><item><title>Game</title><link>https://blog.example/g</link>
      <description>short</description>
      <content:encoded><![CDATA[<a href="https://1fichier.com/?z">dl</a>]]></content:encoded>
      </item></channel></rss>`);
    const [item] = feed.items;
    expect(
      await extract(
        item as Record<string, unknown>,
        "https://blog.example/feed",
        "https://blog.example/g"
      )
    ).toEqual(["https://1fichier.com/?z"]);
  });

  it("is exported", () => expect(typeof extractItemLinks).toBe("function"));
});
