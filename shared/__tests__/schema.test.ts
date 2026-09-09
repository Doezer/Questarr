import { describe, expect, it } from "vitest";

import { insertApiKeySchema, insertDownloaderSchema, insertIndexerSchema } from "@shared/schema";

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

describe("insertApiKeySchema", () => {
  it("trims the name and rejects a blank one", () => {
    const result = insertApiKeySchema.safeParse({
      userId: "user-1",
      name: "  ",
      keyHash: "hash",
      prefix: "qsr_abc12345",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      name: ["Name is required"],
    });
  });

  it("rejects a name longer than 100 characters", () => {
    const result = insertApiKeySchema.safeParse({
      userId: "user-1",
      name: "a".repeat(101),
      keyHash: "hash",
      prefix: "qsr_abc12345",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      name: ["Name is too long"],
    });
  });

  it("accepts a trimmed, reasonably-sized name", () => {
    const result = insertApiKeySchema.safeParse({
      userId: "user-1",
      name: "  Playnite on the living room PC  ",
      keyHash: "hash",
      prefix: "qsr_abc12345",
    });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("Playnite on the living room PC");
  });
});
