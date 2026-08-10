import { describe, expect, it } from "vitest";

import {
  insertDownloaderSchema,
  insertGameSchema,
  insertIndexerSchema,
  updateGameTargetPlatformSchema,
} from "@shared/schema";

describe("insertGameSchema", () => {
  it("accepts a complete target platform pair", () => {
    expect(
      insertGameSchema.safeParse({
        title: "God of War",
        targetPlatformId: 8,
        targetPlatformName: "PlayStation 2",
      }).success
    ).toBe(true);
  });

  it.each([{ targetPlatformId: 8 }, { targetPlatformName: "PlayStation 2" }])(
    "rejects partial target platform data",
    (target) => {
      const result = insertGameSchema.safeParse({ title: "God of War", ...target });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "Target platform ID and name must be provided together",
          }),
        ])
      );
    }
  );

  it("rejects a mismatched complete target platform pair", () => {
    const result = insertGameSchema.safeParse({
      title: "God of War",
      targetPlatformId: 8,
      targetPlatformName: "PlayStation 5",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Target platform ID and name must match a supported platform",
        }),
      ])
    );
  });
});

describe("updateGameTargetPlatformSchema", () => {
  it("allows an existing game to return to the account default", () => {
    expect(
      updateGameTargetPlatformSchema.parse({
        targetPlatformId: null,
        targetPlatformName: null,
      })
    ).toEqual({ targetPlatformId: null, targetPlatformName: null });
  });

  it("rejects malformed target-platform updates", () => {
    expect(
      updateGameTargetPlatformSchema.safeParse({
        targetPlatformId: 8,
        targetPlatformName: null,
      }).success
    ).toBe(false);
  });

  it("rejects mismatched target-platform updates", () => {
    expect(
      updateGameTargetPlatformSchema.safeParse({
        targetPlatformId: 8,
        targetPlatformName: "PlayStation 5",
      }).success
    ).toBe(false);
  });
});

describe("insertIndexerSchema", () => {
  it("requires non-empty name, url, and apiKey", () => {
    const result = insertIndexerSchema.safeParse({
      name: " ",
      protocol: "torznab",
      url: " ",
      apiKey: " ",
      enabled: true,
      priority: 1,
      categories: [],
      rssEnabled: true,
      autoSearchEnabled: true,
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      name: ["Name is required"],
      url: ["URL is required"],
      apiKey: ["API key is required"],
    });
  });
});

describe("insertDownloaderSchema", () => {
  it("requires non-empty name and host", () => {
    const result = insertDownloaderSchema.safeParse({
      name: " ",
      type: "transmission",
      url: " ",
      enabled: true,
      priority: 1,
      category: "games",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      name: ["Name is required"],
      url: ["Host is required"],
    });
  });

  it("requires an API key for SABnzbd", () => {
    const result = insertDownloaderSchema.safeParse({
      name: "SABnzbd",
      type: "sabnzbd",
      url: "http://localhost",
      username: " ",
      enabled: true,
      priority: 1,
      category: "games",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      username: ["API key is required for SABnzbd"],
    });
  });

  it("allows other downloaders without authentication details", () => {
    const result = insertDownloaderSchema.safeParse({
      name: "Transmission",
      type: "transmission",
      url: "http://localhost",
      username: "",
      password: "",
      enabled: true,
      priority: 1,
      category: "games",
    });

    expect(result.success).toBe(true);
  });
});
