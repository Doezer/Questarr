import { describe, expect, it } from "vitest";
import {
  buildDownloaderBaseUrl,
  escapeXml,
  getErrorMessage,
  maxTrackerSwarmCounts,
  normalizePeerCount,
  runDownloaderAction,
} from "../downloaders/utils.js";

describe("downloader shared helpers", () => {
  it("normalizes thrown values into user-facing messages", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("plain string")).toBe("Unknown error");
    expect(getErrorMessage(undefined)).toBe("Unknown error");
  });

  describe("runDownloaderAction", () => {
    it.each([
      ["pause", "Download paused successfully", "Failed to pause download: boom"],
      ["resume", "Download resumed successfully", "Failed to resume download: boom"],
      ["remove", "Download removed successfully", "Failed to remove download: boom"],
    ] as const)("maps a %s outcome to a success/failure result", async (action, ok, fail) => {
      await expect(runDownloaderAction(action, async () => {})).resolves.toEqual({
        success: true,
        message: ok,
      });
      await expect(
        runDownloaderAction(action, async () => {
          throw new Error("boom");
        })
      ).resolves.toEqual({ success: false, message: fail });
    });

    it("awaits the action before reporting success", async () => {
      let finished = false;
      const result = await runDownloaderAction("pause", async () => {
        await Promise.resolve();
        finished = true;
      });
      expect(finished).toBe(true);
      expect(result.success).toBe(true);
    });
  });

  it("escapes XML special characters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("keeps only finite, non-negative peer counts", () => {
    expect(normalizePeerCount(0)).toBe(0);
    expect(normalizePeerCount(12)).toBe(12);
    expect(normalizePeerCount(-1)).toBeUndefined();
    expect(normalizePeerCount(Number.NaN)).toBeUndefined();
    expect(normalizePeerCount(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizePeerCount(undefined)).toBeUndefined();
  });

  it("takes the highest valid swarm count across trackers", () => {
    expect(maxTrackerSwarmCounts([])).toEqual({ seeders: undefined, leechers: undefined });
    expect(
      maxTrackerSwarmCounts([
        { seeders: 3, leechers: -1 },
        { seeders: 10, leechers: 2 },
        { seeders: Number.NaN, leechers: 5 },
      ])
    ).toEqual({ seeders: 10, leechers: 5 });
  });

  describe("buildDownloaderBaseUrl", () => {
    const base = { url: "host", useSsl: false, port: null, urlPath: null };

    it("adds the scheme based on useSsl", () => {
      expect(buildDownloaderBaseUrl(base)).toBe("http://host");
      expect(buildDownloaderBaseUrl({ ...base, useSsl: true })).toBe("https://host");
    });

    it("keeps an explicit scheme and applies the port", () => {
      expect(buildDownloaderBaseUrl({ ...base, url: "https://host/", port: 8080 })).toBe(
        "https://host:8080"
      );
    });

    it("applies urlPath only when asked", () => {
      const withPath = { ...base, urlPath: "transmission/" };
      expect(buildDownloaderBaseUrl(withPath)).toBe("http://host");
      expect(buildDownloaderBaseUrl(withPath, { applyUrlPath: true })).toBe(
        "http://host/transmission"
      );
    });

    it("returns unparseable URLs as typed, without the trailing slash", () => {
      expect(buildDownloaderBaseUrl({ ...base, url: "http://[bad/" })).toBe("http://[bad");
    });
  });
});
