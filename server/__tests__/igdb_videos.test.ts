import { describe, it, expect } from "vitest";
import { toVideos } from "../igdb-videos.js";

describe("toVideos", () => {
  it("maps IGDB videos to name + YouTube id", () => {
    expect(toVideos([{ name: "Trailer", video_id: "dQw4w9WgXcQ" }])).toEqual([
      { name: "Trailer", videoId: "dQw4w9WgXcQ" },
    ]);
  });

  it("falls back to a default name and drops malformed ids", () => {
    expect(
      toVideos([
        { video_id: "abc_DEF-123" },
        { video_id: "abc_DEF-12" },
        { video_id: "abc_DEF-1234" },
        { name: "Bad", video_id: '"><script>' },
        { name: "Missing" },
      ])
    ).toEqual([{ name: "Video", videoId: "abc_DEF-123" }]);
  });

  it("handles undefined", () => {
    expect(toVideos(undefined)).toEqual([]);
  });
});
