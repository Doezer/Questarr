import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { activeTestDialects, setupTestDb, type TestDb } from "./helpers/db-harness.js";
import {
  compileCustomFormats,
  evaluateRelease,
  type ReleaseInput,
} from "../../shared/release-scoring.js";

describe.each(activeTestDialects())("release scoring storage and migration on %s", (dialect) => {
  let ctx: TestDb;
  let service: typeof import("../release-scoring-service.js");
  let userId: string;
  let strictUserId: string;

  beforeAll(async () => {
    ctx = await setupTestDb(dialect);
    service = await import("../release-scoring-service.js");
    const first = await ctx.storage.registerSetupUser({ username: "alice", passwordHash: "h" });
    userId = first.id;
    strictUserId = (await ctx.storage.createUser({ username: "bob", passwordHash: "h" })).id;
  }, 60_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  const release = (title: string): ReleaseInput => ({
    title,
    downloadType: "torrent",
    seeders: 10,
  });

  async function evaluate(uid: string, title: string) {
    const { profile, formats } = await service.loadScoringConfig(uid, ctx.storage);
    return evaluateRelease(
      release(title),
      { gameTitle: "Dishonored" },
      profile,
      compileCustomFormats(formats)
    );
  }

  it("creates a neutral profile when the user has no old settings", async () => {
    const { profile, formats } = await service.loadScoringConfig(userId, ctx.storage);
    expect(profile.minScore).toBe(0);
    expect(profile.minSeeders).toBe(0);
    expect(profile.protocolPreference).toBe("either");
    expect(formats).toEqual([]);
  });

  it("keeps sizes above 2 GiB and edits custom formats", async () => {
    const profile = await ctx.storage.saveReleaseProfile(userId, {
      minScore: 10,
      protocolPreference: "usenet",
      requiredTerms: ["a"],
      ignoredTerms: [],
      minSeeders: 3,
      maxSizeBytes: 90_000_000_000,
      builtInOverrides: { repack: { points: 5 } },
      formatScores: {},
    });
    expect(Number(profile.maxSizeBytes)).toBe(90_000_000_000);

    const format = await ctx.storage.createCustomFormat(userId, {
      name: "Fitgirl",
      specs: [{ field: "group", mode: "exact", value: "FitGirl" }],
      score: 30,
      hardReject: false,
      enabled: true,
    });
    const updated = await ctx.storage.updateCustomFormat(userId, format.id, { score: 40 });
    expect(updated?.score).toBe(40);
    expect(updated?.specs).toEqual(format.specs);
    expect(
      await ctx.storage.updateCustomFormat(strictUserId, format.id, { score: 1 })
    ).toBeUndefined();
    expect(await ctx.storage.deleteCustomFormat(strictUserId, format.id)).toBe(false);
    expect(await ctx.storage.deleteCustomFormat(userId, format.id)).toBe(true);
  });

  it("migrates preferred groups and the seeder floor, once", async () => {
    await ctx.storage.createUserSettings({
      userId: strictUserId,
      preferredReleaseGroups: JSON.stringify(["CODEX", "R.G. Mechanics"]),
      filterByPreferredGroups: true,
      downloadRules: JSON.stringify({ minSeeders: 7 }),
    });
    const first = await service.loadScoringConfig(strictUserId, ctx.storage);
    expect(first.profile.minSeeders).toBe(7);
    expect(first.formats.map((f) => f.name)).toEqual([
      service.PREFERRED_GROUP_FORMAT_NAME,
      service.NON_PREFERRED_GROUP_FORMAT_NAME,
    ]);
    const again = await service.loadScoringConfig(strictUserId, ctx.storage);
    expect(again.formats.map((f) => f.id)).toEqual(first.formats.map((f) => f.id));
  });

  it("strict mode: preferred groups gain points, other groups are rejected", async () => {
    const preferred = await evaluate(strictUserId, "Dishonored.Definitive.Edition-CODEX");
    expect(preferred.accepted).toBe(true);
    expect(preferred.lines.some((l) => l.label === service.PREFERRED_GROUP_FORMAT_NAME)).toBe(true);

    const other = await evaluate(strictUserId, "Dishonored.Definitive.Edition-FLT");
    expect(other.accepted).toBe(false);
    expect(other.rejections.map((r) => r.code)).toContain("custom_format_reject");

    const noGroup = await evaluate(strictUserId, "Dishonored Definitive Edition");
    expect(noGroup.accepted).toBe(false);
  });

  it("non-strict mode only adds the bonus", () => {
    const formats = service.preferredGroupFormats(["CODEX"], false);
    expect(formats).toHaveLength(1);
    expect(formats[0]?.hardReject).toBe(false);
  });

  it("splits a long group list into regexes under the length limit", () => {
    const groups = Array.from({ length: 80 }, (_, i) => `Group.Number.${i}`);
    const [bonus] = service.preferredGroupFormats(groups, false);
    expect(bonus?.specs.length).toBeGreaterThan(1);
    for (const spec of bonus?.specs ?? []) expect(spec.value.length).toBeLessThanOrEqual(200);
  });
});
