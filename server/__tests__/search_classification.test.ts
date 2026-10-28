import { beforeEach, describe, expect, it, vi } from "vitest";

const { classify, enrich, classification } = vi.hoisted(() => ({
  classify: vi.fn(),
  enrich: vi.fn(),
  classification: {
    mode: "hybrid" as "hybrid" | "local" | "cloud",
    holdUnknown: false,
    activeLearning: { collect: false },
  },
}));

vi.mock("../config.js", () => ({ config: { classification } }));
vi.mock("../classification/index.js", () => ({
  releasePipeline: { classify },
  localGuess: vi.fn().mockReturnValue(null),
}));
vi.mock("../classification/active-learning.js", () => ({ collectCandidate: vi.fn() }));
vi.mock("../typesafe.js", () => ({
  typesafeClient: { isConfigured: enrich, analyzeRelease: vi.fn() },
}));
vi.mock("../storage.js", () => ({ storage: {} }));
vi.mock("../torznab.js", () => ({ torznabClient: {} }));
vi.mock("../newznab.js", () => ({ newznabClient: {} }));
vi.mock("../logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: { child: () => log }, searchLogger: log };
});

import { classifySearchResults, type SearchItem } from "../search.js";

const item = (title: string): SearchItem => ({
  title,
  link: "x",
  pubDate: "",
  indexerId: "i",
  indexerName: "idx",
  category: [],
  guid: title,
  downloadType: "torrent",
});

describe("classifySearchResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    classification.mode = "hybrid";
    enrich.mockResolvedValue(false);
  });

  it("types every result through the pipeline, as auto-download does", async () => {
    classify.mockImplementation(async ({ title }: { title: string }) =>
      title.includes("Update")
        ? { class: "patch", confidence: 0.9, source: "local", path: ["rules", "local"] }
        : { class: "full_game", confidence: null, source: "rules", path: ["rules"] }
    );
    const items = await classifySearchResults([item("Game Update v2"), item("Game")], null, "Game");
    expect(items[0]).toMatchObject({ aiReleaseType: "update", aiReleaseTypeConfidence: 0.9 });
    expect(items[1]).toMatchObject({ aiReleaseType: "full_game" });
    expect(items[1]).not.toHaveProperty("aiReleaseTypeConfidence");
    expect(classify).toHaveBeenCalledWith(expect.objectContaining({ gameTitle: "Game" }));
  });

  it("maps flags onto the existing release types and keeps the size score", async () => {
    classify.mockResolvedValue({
      class: "unknown",
      confidence: 0.8,
      source: "cloud",
      flags: ["crack_only"],
      path: ["rules", "local", "cloud"],
      legitimacyScore: 0.2,
    });
    const [result] = await classifySearchResults([item("Game-CRACK")], "pc", undefined);
    expect(result).toMatchObject({ aiReleaseType: "crack_only", aiLegitimacyScore: 0.2 });
  });

  it("leaves a release untyped when the pipeline has no verdict or fails", async () => {
    classify
      .mockResolvedValueOnce({ class: "unknown", confidence: null, source: "rules", path: [] })
      .mockRejectedValueOnce(new Error("boom"));
    const items = await classifySearchResults([item("A"), item("B")], null, undefined);
    expect(items[0]).not.toHaveProperty("aiReleaseType");
    expect(items[1]).not.toHaveProperty("aiReleaseType");
  });

  it("caps provider-backed modes but classifies everything locally", async () => {
    classify.mockResolvedValue({ class: "full_game", confidence: null, source: "rules", path: [] });
    const many = Array.from({ length: 20 }, (_, i) => item(`Game ${i}`));
    await classifySearchResults(many, null, undefined);
    expect(classify).toHaveBeenCalledTimes(15);
    classify.mockClear();
    classification.mode = "local";
    await classifySearchResults(many, null, undefined);
    expect(classify).toHaveBeenCalledTimes(20);
  });

  it("keeps the legacy Jev-only call in cloud mode", async () => {
    classification.mode = "cloud";
    const items = [item("Game")];
    expect(await classifySearchResults(items, null, undefined)).toBe(items);
    expect(classify).not.toHaveBeenCalled();
  });
});
