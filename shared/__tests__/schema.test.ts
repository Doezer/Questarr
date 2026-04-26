import { describe, expect, it } from "vitest";

import { insertDownloaderSchema, insertIndexerSchema } from "@shared/schema";

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
