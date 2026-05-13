import { describe, expect, it } from "vitest";
import { truncateLogData } from "../log-response.js";

describe("truncateLogData", () => {
  it("preserves nested arrays of primitive values", () => {
    const result = truncateLogData({
      gameId: {
        topStatus: "completed",
        count: 1,
        downloadTypes: ["torrent", "usenet"],
        hasUpdateDownload: false,
      },
    });

    expect(result).toEqual({
      gameId: {
        topStatus: "completed",
        count: 1,
        downloadTypes: ["torrent", "usenet"],
        hasUpdateDownload: false,
      },
    });
  });

  it("still truncates deeply nested object arrays", () => {
    const result = truncateLogData({
      gameId: {
        nested: {
          downloads: [{ type: "torrent" }],
        },
      },
    });

    expect(result).toEqual({
      gameId: {
        nested: {
          downloads: "[Object/Array]",
        },
      },
    });
  });
});
