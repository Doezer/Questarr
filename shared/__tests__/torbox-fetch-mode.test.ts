import { describe, expect, it } from "vitest";
import { getTorBoxFetchMode, isLinkOnlyDownloader } from "../downloader-types";
import { insertDownloaderSchema } from "../schema";

const base = {
  name: "TorBox",
  type: "torbox",
  url: "https://api.torbox.app",
  password: "key",
};

describe("TorBox fetch mode", () => {
  it("defaults to local and reads linkOnly from the settings JSON", () => {
    expect(getTorBoxFetchMode(null)).toBe("local");
    expect(getTorBoxFetchMode("not json")).toBe("local");
    expect(getTorBoxFetchMode("[]")).toBe("local");
    expect(getTorBoxFetchMode('{"fetchMode":"linkOnly"}')).toBe("linkOnly");
    expect(getTorBoxFetchMode('{"fetchMode":"other"}')).toBe("local");
  });

  it("only applies to TorBox", () => {
    const settings = '{"fetchMode":"linkOnly"}';
    expect(isLinkOnlyDownloader({ type: "torbox", settings })).toBe(true);
    expect(isLinkOnlyDownloader({ type: "qbittorrent", settings })).toBe(false);
  });

  it("asks for a staging path only when files are fetched locally", () => {
    expect(insertDownloaderSchema.safeParse(base).success).toBe(false);
    expect(
      insertDownloaderSchema.safeParse({ ...base, settings: '{"fetchMode":"linkOnly"}' }).success
    ).toBe(true);
    expect(
      insertDownloaderSchema.safeParse({ ...base, downloadPath: "/data/staging" }).success
    ).toBe(true);
  });
});
