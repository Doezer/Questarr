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

  it("preserves full nested message strings", () => {
    const fullMessage = "Synology ".repeat(20);

    const result = truncateLogData({
      response: {
        success: false,
        message: fullMessage,
      },
    });

    expect(result).toEqual({
      response: {
        success: false,
        message: fullMessage,
      },
    });
  });

  it("continues truncating other long strings", () => {
    const result = truncateLogData({
      response: {
        detail: "a".repeat(60),
      },
    });

    expect(result).toEqual({
      response: {
        detail: `${"a".repeat(50)}...`,
      },
    });
  });
});
