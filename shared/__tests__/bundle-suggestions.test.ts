import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUNDLE_EXTRA_MAX_PERCENT,
  isSuggestedExtra,
  suggestBundleExtras,
} from "../bundle-suggestions.js";

const GB = 1024 ** 3;

describe("isSuggestedExtra", () => {
  it("defaults to a quarter of the main release", () => {
    expect(DEFAULT_BUNDLE_EXTRA_MAX_PERCENT).toBe(25);
    expect(isSuggestedExtra(40 * GB, 10 * GB)).toBe(true);
    expect(isSuggestedExtra(40 * GB, 10 * GB + 1)).toBe(false);
  });

  it("never suggests an extra of unknown or zero size", () => {
    expect(isSuggestedExtra(40 * GB, undefined)).toBe(false);
    expect(isSuggestedExtra(40 * GB, null)).toBe(false);
    expect(isSuggestedExtra(40 * GB, 0)).toBe(false);
  });

  it("suggests nothing when the main size is unknown", () => {
    expect(isSuggestedExtra(undefined, GB)).toBe(false);
    expect(isSuggestedExtra(0, GB)).toBe(false);
  });

  it("honours a custom cutoff", () => {
    expect(isSuggestedExtra(40 * GB, 20 * GB, 50)).toBe(true);
    expect(isSuggestedExtra(40 * GB, 20 * GB, 10)).toBe(false);
  });
});

describe("suggestBundleExtras", () => {
  it("keeps only the small extras, in order", () => {
    const extras = [
      { id: "ost", size: GB },
      { id: "big-dlc", size: 30 * GB },
      { id: "unknown" },
      { id: "patch-pack", size: 5 * GB },
    ];
    expect(suggestBundleExtras(40 * GB, extras).map((e) => e.id)).toEqual(["ost", "patch-pack"]);
  });
});

describe("download rules defaults", () => {
  it("keeps the new settings at their safe defaults", async () => {
    const { downloadRulesSchema } = await import("../schema.js");
    const rules = downloadRulesSchema.parse({});
    expect(rules.upgradePreferPatches).toBe(false);
    expect(rules.bundleExtraMaxPercent).toBe(DEFAULT_BUNDLE_EXTRA_MAX_PERCENT);
  });
});
