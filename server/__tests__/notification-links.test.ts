import { describe, expect, it } from "vitest";
import { notificationPath, notificationUrl } from "../notification-links.js";

describe("notification context links", () => {
  it("converts legacy game commands to the details page", () => {
    expect(notificationPath("modal:game:game/1")).toBe("/games/game%2F1");
    expect(notificationPath("modal:game:")).toBeNull();
  });

  it.each([
    ["https://questarr.example", "", "https://questarr.example/games/game-1"],
    [
      "https://questarr.example/Questarr/",
      "/Questarr",
      "https://questarr.example/Questarr/games/game-1",
    ],
    ["https://questarr.example", "/Questarr", "https://questarr.example/Questarr/games/game-1"],
  ])("resolves a game link with base %s", (base, prefix, expected) => {
    expect(notificationUrl("/games/game-1", base, prefix)).toBe(expected);
  });

  it("preserves settings tabs and anchors", () => {
    expect(
      notificationUrl("/settings?tab=system#classification-review", "https://example.com")
    ).toBe("https://example.com/settings?tab=system#classification-review");
  });

  it("omits links without a configured public address", () => {
    expect(notificationUrl("/downloads", undefined)).toBeNull();
  });

  it.each(["/../admin", "/%2e%2e/admin", "/../Questarr-other/games/1", "/..\\admin"])(
    "rejects links escaping the configured subpath: %s",
    (link) => {
      expect(notificationUrl(link, "https://example.com/Questarr")).toBeNull();
      expect(notificationUrl(link, "https://example.com", "/Questarr")).toBeNull();
    }
  );

  it.each([null, "error-report:123", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "does not expose unsupported or external context %s",
    (link) => {
      expect(notificationUrl(link, "https://questarr.example")).toBeNull();
    }
  );

  it.each(["bad url", "javascript:alert(1)", "https://user:password@example.com"])(
    "rejects invalid or credentialed application URLs",
    (base) => {
      expect(notificationUrl("/downloads", base)).toBeNull();
    }
  );
});
