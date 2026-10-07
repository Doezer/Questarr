import { describe, expect, it } from "vitest";
import {
  BUILT_IN_RULES,
  classifyIndexerCategories,
  classifyTitleMatch,
  compileCustomFormats,
  DEFAULT_RELEASE_PROFILE,
  evaluateRelease,
  evaluateReleases,
  MAX_FORMAT_REGEX_LENGTH,
  validateFormatSpec,
  type CustomFormat,
  type ReleaseInput,
  type ReleaseProfile,
  type TitleMatch,
} from "../release-scoring.js";

const torrent = (title: string, extra: Partial<ReleaseInput> = {}): ReleaseInput => ({
  title,
  downloadType: "torrent",
  ...extra,
});

const profile = (overrides: Partial<ReleaseProfile> = {}): ReleaseProfile => ({
  ...DEFAULT_RELEASE_PROFILE,
  ...overrides,
});

describe("classifyTitleMatch", () => {
  it.each<[string, string, TitleMatch]>([
    // the game itself, its editions, versions and sources
    ["Dishonored-CODEX", "Dishonored", "exact"],
    ["Dishonored.Definitive.Edition-GOG", "Dishonored", "exact"],
    ["Hades.v1.38290-GOG", "Hades", "exact"],
    ["DOOM.2016-CODEX", "DOOM", "exact"],
    ["Prey.Digital.Deluxe-CODEX", "Prey", "exact"],
    ["Fallout.76-P2P", "Fallout 76", "exact"],
    ["Elden Ring [FitGirl Repack]", "Elden Ring", "exact"],
    ["Stardew Valley v1.6.9 MULTi12 [DODI Repack]", "Stardew Valley", "exact"],
    ["Dishonored.Update.2-GROUP", "Dishonored", "exact"],
    // spelling differences between IGDB titles and release names
    ["STALKER.Shadow.of.Chernobyl-GOG", "S.T.A.L.K.E.R.: Shadow of Chernobyl", "exact"],
    ["Tom.Clancys.Rainbow.Six.Siege-CODEX", "Tom Clancy's Rainbow Six Siege", "exact"],
    ["Tales.And.Tactics-TENOKE", "Tales & Tactics", "exact"],
    ["Witcher.3.Wild.Hunt-GOG", "The Witcher 3", "contains"],
    // numbered titles followed by their subtitle or DLC name
    ["Cyberpunk.2077.Phantom.Liberty-RUNE", "Cyberpunk 2077", "contains"],
    // other games in the same series
    ["Dishonored.2-CODEX", "Dishonored", "sequel"],
    ["Hades.II.v1.0-RUNE", "Hades", "sequel"],
    ["Hades.II.2.0-RUNE", "Hades", "sequel"],
    ["The.Witcher.3-GOG", "The Witcher", "sequel"],
    ["Dishonored.Death.of.the.Outsider-CODEX", "Dishonored", "spinoff"],
    ["DOOM.Eternal-CODEX", "DOOM", "spinoff"],
    ["Elden.Ring.Shadow.of.the.Erdtree-RUNE", "Elden Ring", "spinoff"],
    // not the game
    ["F1.23-RUNE", "F1 24", "mismatch"],
    ["Fabletown-CODEX", "Fable", "mismatch"],
    ["Totally.Unrelated-CODEX", "Dishonored", "mismatch"],
  ])("%s for %s is %s", (release, game, expected) => {
    expect(classifyTitleMatch(release, game)).toBe(expected);
  });

  it("keeps the best match across alternative titles", () => {
    expect(classifyTitleMatch("Witcher.3.Wild.Hunt-GOG", "The Witcher 3", [])).toBe("contains");
    expect(
      classifyTitleMatch("Witcher.3.Wild.Hunt-GOG", "The Witcher 3", ["The Witcher 3: Wild Hunt"])
    ).toBe("exact");
  });

  it("is a mismatch for an empty title", () => {
    expect(classifyTitleMatch("Dishonored-CODEX", "")).toBe("mismatch");
    expect(classifyTitleMatch("", "Dishonored")).toBe("mismatch");
  });
});

describe("classifyIndexerCategories", () => {
  it.each<[string[] | undefined, string]>([
    [["4050"], "game"],
    [["4000"], "game"],
    [["1000"], "game"],
    [["1180"], "game"],
    [["2000", "4050"], "game"],
    [["2040"], "non_game"],
    [["3010", "5030"], "non_game"],
    [["8000"], "unknown"],
    [["100045"], "unknown"],
    [["4010"], "unknown"],
    [["2000", "8000"], "unknown"],
    [["abc"], "unknown"],
    [[], "unknown"],
    [undefined, "unknown"],
  ])("%j is %s", (categories, expected) => {
    expect(classifyIndexerCategories(categories)).toBe(expected);
  });
});

describe("evaluateRelease built-in rules", () => {
  const ctx = { gameTitle: "Dishonored" };

  it("scores an exact scene release in a game category", () => {
    const result = evaluateRelease(torrent("Dishonored-CODEX", { category: ["4050"] }), ctx);
    expect(result.accepted).toBe(true);
    expect(result.titleMatch).toBe("exact");
    expect(result.category).toBe("main");
    expect(result.lines.map((l) => l.ruleId)).toEqual([
      "title_exact",
      "category_game",
      "scene_release",
    ]);
    expect(result.score).toBe(155);
  });

  it("does not count store or repacker suffixes as scene groups", () => {
    const gog = evaluateRelease(torrent("Dishonored-GOG"), ctx);
    expect(gog.lines.map((l) => l.ruleId)).toEqual(["title_exact", "storefront_source"]);
    const fitgirl = evaluateRelease(torrent("Dishonored-FitGirl"), ctx);
    expect(fitgirl.lines.map((l) => l.ruleId)).toEqual(["title_exact", "repack"]);
  });

  it("rejects sequels and mismatches", () => {
    const sequel = evaluateRelease(torrent("Dishonored.2-CODEX"), ctx);
    expect(sequel.accepted).toBe(false);
    expect(sequel.rejections).toContainEqual({ code: "title_sequel" });

    const other = evaluateRelease(torrent("Prey-CODEX"), ctx);
    expect(other.accepted).toBe(false);
    expect(other.rejections).toContainEqual({ code: "title_mismatch" });
  });

  it("penalizes a spinoff below the default minimum score, without a hard rejection", () => {
    const spinoff = torrent("Dishonored.Death.of.the.Outsider-CODEX");
    const result = evaluateRelease(spinoff, ctx);
    expect(result.lines.find((l) => l.ruleId === "title_spinoff")?.points).toBe(-60);
    expect(result.rejections).toEqual([{ code: "below_min_score", detail: "-40" }]);
    expect(evaluateRelease(spinoff, ctx, profile({ minScore: -100 })).accepted).toBe(true);
  });

  it("rejects non-game categories but not unknown ones", () => {
    const movie = evaluateRelease(torrent("Dishonored-CODEX", { category: ["2040"] }), ctx);
    expect(movie.rejections).toContainEqual({ code: "non_game_category" });
    const other = evaluateRelease(torrent("Dishonored-CODEX", { category: ["8000"] }), ctx);
    expect(other.accepted).toBe(true);
  });

  it("rejects video, music and book releases", () => {
    const result = evaluateRelease(torrent("Dishonored.Gameplay.1080p.x264-GRP"), ctx);
    expect(result.rejections).toContainEqual({ code: "non_game_media" });
  });

  it("checks the platform when one is wanted", () => {
    const switchCtx = { gameTitle: "Hades", platform: "Switch" };
    const nsw = evaluateRelease(torrent("Hades.NSW-VENOM"), switchCtx);
    expect(nsw.accepted).toBe(true);
    expect(nsw.lines.map((l) => l.ruleId)).toContain("platform_match");

    const pc = evaluateRelease(torrent("Hades-CODEX"), switchCtx);
    expect(pc.rejections).toContainEqual({ code: "wrong_platform" });

    // PC releases usually carry no platform marker
    const unmarked = evaluateRelease(torrent("Hades-CODEX"), {
      gameTitle: "Hades",
      platform: "PC",
    });
    expect(unmarked.accepted).toBe(true);
  });

  it("rejects executables and disguised files", () => {
    expect(evaluateRelease(torrent("Dishonored.exe"), ctx).rejections).toContainEqual({
      code: "risky_file",
    });
    expect(evaluateRelease(torrent("Dishonored.mkv.exe"), ctx).rejections).toContainEqual({
      code: "risky_file",
    });
    expect(evaluateRelease(torrent("Dishonored-CODEX"), ctx).accepted).toBe(true);
  });

  it("penalizes a size far from the expected one", () => {
    const sized = { gameTitle: "Dishonored", expectedSizeBytes: 10_000_000_000 };
    const tiny = evaluateRelease(torrent("Dishonored-CODEX", { size: 1_000_000_000 }), sized);
    expect(tiny.lines.map((l) => l.ruleId)).toContain("size_mismatch");
    const close = evaluateRelease(torrent("Dishonored-CODEX", { size: 9_000_000_000 }), sized);
    expect(close.lines.map((l) => l.ruleId)).not.toContain("size_mismatch");
  });

  it("applies built-in overrides, except disabling a locked rule", () => {
    const tuned = profile({
      builtInOverrides: {
        scene_release: { enabled: false },
        title_exact: { points: 10 },
        title_sequel: { enabled: false },
      },
    });
    const exact = evaluateRelease(torrent("Dishonored-CODEX"), ctx, tuned);
    expect(exact.lines).toEqual([
      { ruleId: "title_exact", label: "Title matches the game", points: 10 },
    ]);
    const sequel = evaluateRelease(torrent("Dishonored.2-CODEX"), ctx, tuned);
    expect(sequel.rejections).toContainEqual({ code: "title_sequel" });
  });

  it("gives every built-in rule a unique id", () => {
    const ids = BUILT_IN_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("evaluateRelease profile checks", () => {
  const ctx = { gameTitle: "Dishonored" };

  it("needs at least one required term and no ignored term", () => {
    const strict = profile({ requiredTerms: ["GOG", "DRM Free"], ignoredTerms: ["crack only"] });
    expect(evaluateRelease(torrent("Dishonored-GOG"), ctx, strict).accepted).toBe(true);
    expect(evaluateRelease(torrent("Dishonored.DRM-Free-X"), ctx, strict).accepted).toBe(true);
    expect(evaluateRelease(torrent("Dishonored-CODEX"), ctx, strict).rejections).toContainEqual({
      code: "required_term_missing",
      detail: "GOG, DRM Free",
    });
    expect(
      evaluateRelease(torrent("Dishonored.Crack.Only-GOG"), ctx, strict).rejections
    ).toContainEqual({ code: "ignored_term", detail: "crack only" });
  });

  it("reads /pattern/ terms as regexes", () => {
    const regexTerms = profile({ requiredTerms: ["/multi\\d+/"], ignoredTerms: ["/^\\[.*\\]/"] });
    expect(evaluateRelease(torrent("Dishonored.MULTi8-GOG"), ctx, regexTerms).accepted).toBe(true);
    expect(evaluateRelease(torrent("Dishonored.MULTi-GOG"), ctx, regexTerms).accepted).toBe(false);
    expect(
      evaluateRelease(torrent("[Tag] Dishonored MULTi8"), ctx, regexTerms).rejections
    ).toContainEqual({ code: "ignored_term", detail: "/^\\[.*\\]/" });
    // an invalid regex is read as plain text
    const broken = profile({ requiredTerms: ["/(unclosed/"] });
    expect(evaluateRelease(torrent("Dishonored-GOG"), ctx, broken).accepted).toBe(false);
  });

  it("rejects torrents under the seeder minimum, never usenet", () => {
    const seeded = profile({ minSeeders: 5 });
    expect(
      evaluateRelease(torrent("Dishonored-CODEX", { seeders: 2 }), ctx, seeded).rejections
    ).toContainEqual({ code: "min_seeders", detail: "2", temporary: true });
    expect(evaluateRelease(torrent("Dishonored-CODEX", { seeders: 5 }), ctx, seeded).accepted).toBe(
      true
    );
    const nzb: ReleaseInput = { title: "Dishonored-CODEX", downloadType: "usenet" };
    expect(evaluateRelease(nzb, ctx, seeded).accepted).toBe(true);
  });

  it("rejects releases over the size limit", () => {
    const capped = profile({ maxSizeBytes: 1000 });
    expect(
      evaluateRelease(torrent("Dishonored-CODEX", { size: 2000 }), ctx, capped).rejections
    ).toContainEqual({ code: "max_size", detail: "2000" });
    expect(evaluateRelease(torrent("Dishonored-CODEX"), ctx, capped).accepted).toBe(true);
  });

  it("rejects releases under the minimum score", () => {
    const demanding = profile({ minScore: 150 });
    const result = evaluateRelease(torrent("Dishonored-GOG"), ctx, demanding);
    expect(result.score).toBe(115);
    expect(result.rejections).toContainEqual({ code: "below_min_score", detail: "115" });
  });
});

describe("custom formats", () => {
  const ctx = { gameTitle: "Dishonored" };
  const format = (overrides: Partial<CustomFormat>): CustomFormat => ({
    id: "f1",
    name: "Format",
    specs: [],
    score: 0,
    hardReject: false,
    enabled: true,
    ...overrides,
  });

  it("adds the score of a matching format", () => {
    const preferGog = format({
      name: "GOG",
      score: 50,
      specs: [{ field: "group", mode: "exact", value: "gog" }],
    });
    const [best, other] = evaluateReleases(
      [torrent("Dishonored-CODEX"), torrent("Dishonored-GOG")],
      ctx,
      DEFAULT_RELEASE_PROFILE,
      [preferGog]
    );
    expect(best?.item.title).toBe("Dishonored-GOG");
    expect(best?.evaluation.matchedFormats).toEqual(["f1"]);
    expect(best?.evaluation.lines).toContainEqual({ ruleId: "cf:f1", label: "GOG", points: 50 });
    expect(other?.evaluation.matchedFormats).toEqual([]);
  });

  it("accepts any spec on the same field, unless marked required", () => {
    const either = format({
      specs: [
        { field: "group", mode: "exact", value: "CODEX" },
        { field: "group", mode: "exact", value: "GOG" },
      ],
      score: 10,
    });
    const both = format({
      id: "f2",
      specs: [
        { field: "title", mode: "contains", value: "dishonored" },
        { field: "group", mode: "exact", value: "GOG" },
      ],
      score: 1,
    });
    const run = (title: string) =>
      evaluateReleases([torrent(title)], ctx, DEFAULT_RELEASE_PROFILE, [either, both])[0]
        ?.evaluation.matchedFormats;
    expect(run("Dishonored-CODEX")).toEqual(["f1"]);
    expect(run("Dishonored-GOG")).toEqual(["f1", "f2"]);
    expect(run("Dishonored-RUNE")).toEqual([]);
  });

  it("uses the profile's score for a format when it has one", () => {
    const gog = format({ specs: [{ field: "group", mode: "exact", value: "GOG" }], score: 50 });
    const result = evaluateReleases(
      [torrent("Dishonored-GOG")],
      ctx,
      profile({ formatScores: { f1: -10000 } }),
      [gog]
    );
    expect(result[0]?.evaluation.lines).toContainEqual({
      ruleId: "cf:f1",
      label: "Format",
      points: -10000,
    });
    expect(result[0]?.evaluation.accepted).toBe(false);
  });

  it("combines negated required specs into a rejection list", () => {
    // "a group that is neither CODEX nor GOG" rejects everything else
    const onlyPreferred = format({
      name: "Not a preferred group",
      hardReject: true,
      specs: [
        { field: "group", mode: "exact", value: "CODEX", negate: true, required: true },
        { field: "group", mode: "exact", value: "GOG", negate: true, required: true },
      ],
    });
    const compiled = compileCustomFormats([onlyPreferred]);
    const run = (title: string) =>
      evaluateRelease(torrent(title), ctx, DEFAULT_RELEASE_PROFILE, compiled);
    expect(run("Dishonored-CODEX").accepted).toBe(true);
    expect(run("Dishonored-GOG").accepted).toBe(true);
    expect(run("Dishonored-RUNE").rejections).toContainEqual({
      code: "custom_format_reject",
      detail: "Not a preferred group",
    });
  });

  it("matches title, uploader, category, protocol and indexer fields", () => {
    const item = torrent("Dishonored.MULTi8-CODEX", {
      poster: "uploader@example.com",
      category: ["4050"],
      indexerName: "My Indexer",
    });
    const cases: CustomFormat["specs"][] = [
      [{ field: "title", mode: "regex", value: "multi\\d+" }],
      [{ field: "uploader", mode: "contains", value: "uploader@" }],
      [{ field: "category", mode: "exact", value: "4050" }],
      [{ field: "protocol", mode: "exact", value: "torrent" }],
      [{ field: "indexer", mode: "exact", value: "my indexer" }],
    ];
    for (const specs of cases) {
      const result = evaluateReleases([item], ctx, DEFAULT_RELEASE_PROFILE, [
        format({ specs, score: 1 }),
      ]);
      expect(result[0]?.evaluation.matchedFormats, JSON.stringify(specs)).toEqual(["f1"]);
    }
  });

  it("treats a missing field value as not matching", () => {
    const result = evaluateReleases([torrent("Dishonored")], ctx, DEFAULT_RELEASE_PROFILE, [
      format({ specs: [{ field: "uploader", mode: "contains", value: "x" }], score: 1 }),
      format({
        id: "f2",
        specs: [{ field: "uploader", mode: "contains", value: "x", negate: true }],
        score: 1,
      }),
    ]);
    expect(result[0]?.evaluation.matchedFormats).toEqual(["f2"]);
  });

  it("skips disabled formats and reports invalid ones", () => {
    const compiled = compileCustomFormats([
      format({
        id: "off",
        enabled: false,
        specs: [{ field: "title", mode: "contains", value: "a" }],
      }),
      format({ id: "empty" }),
      format({ id: "bad", specs: [{ field: "title", mode: "regex", value: "(" }] }),
      format({ id: "ok", specs: [{ field: "title", mode: "contains", value: "a" }] }),
    ]);
    expect(compiled.formats.map((f) => f.format.id)).toEqual(["ok"]);
    expect(compiled.errors.map((e) => e.formatId)).toEqual(["empty", "bad"]);
  });

  it("validates specs", () => {
    expect(validateFormatSpec({ field: "title", mode: "contains", value: " " })).toBe(
      "Value is empty"
    );
    expect(
      validateFormatSpec({
        field: "title",
        mode: "regex",
        value: "a".repeat(MAX_FORMAT_REGEX_LENGTH + 1),
      })
    ).toMatch(/longer than/);
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "[" })).not.toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "^dis" })).toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "(gog|steam)$" })).toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "([+*|])+" })).toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "((ab)c)+" })).toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "(?:ab)+" })).toBeNull();
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "\\(a+\\)+" })).toBeNull();
  });

  it.each(["(a+)+$", "(\\w*\\s?)*x", "(a|aa){2,}b", "([a-z]+\\.)+exe", "(dis|dish)+", "^(a?b?)+$"])(
    "refuses the nested quantifier %s",
    (value) => {
      expect(validateFormatSpec({ field: "title", mode: "regex", value })).toMatch(
        /repeats a group/
      );
      // as a profile term it falls back to plain text, so it cannot hang matching
      const terms = profile({ ignoredTerms: [`/${value}/`], minScore: -1000 });
      const title = `Dishonored.${"a".repeat(5000)}!`;
      expect(evaluateRelease(torrent(title), { gameTitle: "Dishonored" }, terms).accepted).toBe(
        true
      );
    }
  );

  it("keeps a plain regex usable", () => {
    expect(validateFormatSpec({ field: "title", mode: "regex", value: "multi\\d+" })).toBeNull();
  });
});

describe("evaluateReleases", () => {
  it("sorts accepted releases first, then by score, and keeps rejected ones", () => {
    const sorted = evaluateReleases(
      [
        torrent("Dishonored.2-CODEX"),
        torrent("Dishonored-GOG"),
        torrent("Dishonored-CODEX", { category: ["4050"] }),
      ],
      { gameTitle: "Dishonored" }
    );
    expect(sorted.map((r) => [r.item.title, r.evaluation.accepted])).toEqual([
      ["Dishonored-CODEX", true],
      ["Dishonored-GOG", true],
      ["Dishonored.2-CODEX", false],
    ]);
  });

  it("breaks score ties by protocol preference, indexer priority, then seeders", () => {
    const ctx = { gameTitle: "Dishonored" };
    const usenet: ReleaseInput = { title: "Dishonored-AAA", downloadType: "usenet" };
    const preferUsenet = profile({ protocolPreference: "usenet" });
    const byProtocol = evaluateReleases([torrent("Dishonored-BBB"), usenet], ctx, preferUsenet);
    expect(byProtocol.map((r) => r.item.title)).toEqual(["Dishonored-AAA", "Dishonored-BBB"]);
    expect(byProtocol[1]?.evaluation.preferredProtocol).toBe(false);
    expect(byProtocol[1]?.evaluation.accepted).toBe(true);

    const byPriority = evaluateReleases(
      [
        torrent("Dishonored-AAA", { indexerPriority: 2, seeders: 5000 }),
        torrent("Dishonored-BBB", { indexerPriority: 1, seeders: 5 }),
      ],
      ctx
    );
    expect(byPriority.map((r) => r.item.title)).toEqual(["Dishonored-BBB", "Dishonored-AAA"]);

    const bySeeders = evaluateReleases(
      [
        torrent("Dishonored-AAA", { seeders: 900 }),
        torrent("Dishonored-BBB", { seeders: 1000 }),
        torrent("Dishonored-CCC", { seeders: 950 }),
      ],
      ctx
    );
    // 1000 is a higher order of magnitude; 900 and 950 tie and keep their order
    expect(bySeeders.map((r) => r.item.title)).toEqual([
      "Dishonored-BBB",
      "Dishonored-AAA",
      "Dishonored-CCC",
    ]);
  });

  it("keeps the input order for equal scores", () => {
    const sorted = evaluateReleases([torrent("Dishonored-AAA"), torrent("Dishonored-BBB")], {
      gameTitle: "Dishonored",
    });
    expect(sorted.map((r) => r.item.title)).toEqual(["Dishonored-AAA", "Dishonored-BBB"]);
  });
});
