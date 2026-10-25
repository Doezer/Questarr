import { describe, it, expect, vi, afterEach } from "vitest";
import { runBenchmark } from "../benchmark.js";
import {
  BUDGET_EXHAUSTED,
  jevClassifier,
  mapJevChoice,
  openRouterClassifier,
  parseChatAnswer,
} from "../classifiers/remote.js";
import { TfidfClassifier } from "../classifiers/tfidf.js";
import { computeMetrics } from "../metrics.js";
import { groupedSplit } from "../split.js";
import type { BenchClassifier, LabeledRelease } from "../types.js";

function release(name: string, game: string, label: LabeledRelease["label"]): LabeledRelease {
  return { releaseName: name, gameTitle: game, label, flags: [], rawLabel: label };
}

function toyRecords(): LabeledRelease[] {
  const out: LabeledRelease[] = [];
  for (let g = 0; g < 8; g++) {
    const game = `Game ${String.fromCharCode(65 + g)}`;
    const slug = game.replace(" ", ".");
    out.push(release(`${slug}.Update.v1.${g}-GRP`, game, "patch"));
    out.push(release(`${slug}.Update.v2.${g}-GRP`, game, "patch"));
    out.push(release(`${slug}.Costume.DLC.Pack${g}-GRP`, game, "dlc"));
    out.push(release(`${slug}.Season.DLC.Pack${g}-GRP`, game, "dlc"));
    out.push(release(`${slug}.S01E0${g % 9}.1080p.WEB.H264-CBFM`, game, "unknown"));
  }
  return out;
}

describe("groupedSplit", () => {
  it("never puts one game in two parts and is deterministic", () => {
    const records = toyRecords();
    const a = groupedSplit(records, 7);
    const b = groupedSplit(records, 7);
    expect(a).toEqual(b);
    const partOf = new Map<string, string>();
    for (const [part, rows] of Object.entries(a)) {
      for (const row of rows) {
        const seen = partOf.get(row.gameTitle);
        expect(seen === undefined || seen === part).toBe(true);
        partOf.set(row.gameTitle, part);
      }
    }
    expect(a.train.length + a.validation.length + a.test.length).toBe(records.length);
    expect(a.test.length).toBeGreaterThan(0);
  });

  it("keeps every positive-ratio part non-empty when game sizes are very uneven", () => {
    const records = [
      release("a-GRP", "G0", "dlc"),
      release("b-GRP", "G1", "patch"),
      ...Array.from({ length: 100 }, (_, i) => release(`c${i}-GRP`, "G2", "dlc")),
    ];
    for (const seed of [1, 42, 99]) {
      const split = groupedSplit(records, seed);
      expect(split.train.length).toBeGreaterThan(0);
      expect(split.validation.length).toBeGreaterThan(0);
      expect(split.test.length).toBeGreaterThan(0);
    }
  });

  it("refuses to split fewer than three games", () => {
    expect(() => groupedSplit([release("a", "G", "dlc"), release("b", "H", "dlc")], 1)).toThrow(
      /at least 3/
    );
  });
});

describe("computeMetrics", () => {
  it("computes precision, recall, abstention and auto-accept precision by hand", () => {
    const truth = ["patch", "patch", "dlc", "dlc", "unknown", "full_game"] as const;
    const preds = ["patch", "dlc", "dlc", "unknown", "unknown", "patch"].map((label) => ({
      label: label as (typeof truth)[number],
    }));
    const m = computeMetrics(truth, preds);
    expect(m.accuracy).toBeCloseTo(3 / 6);
    expect(m.abstentionRate).toBeCloseTo(2 / 6);
    expect(m.autoAcceptCount).toBe(4);
    expect(m.autoAcceptPrecision).toBeCloseTo(2 / 4);
    expect(m.perClass.patch.precision).toBeCloseTo(1 / 2);
    expect(m.perClass.patch.recall).toBeCloseTo(1 / 2);
    expect(m.perClass.dlc.precision).toBeCloseTo(1 / 2);
    expect(m.perClass.dlc.recall).toBeCloseTo(1 / 2);
    expect(m.perClass.full_game.f1).toBe(0);
    expect(m.perClass.expansion.f1).toBeNull();
    expect(m.unmeasuredClasses).toEqual(["expansion"]);
    expect(m.perClass.unknown.precision).toBeCloseTo(1 / 2);
    expect(m.perClass.unknown.recall).toBe(1);
    // macro F1 over patch (0.5), dlc (0.5), unknown (2/3) and full_game (0); expansion has no support
    expect(m.macroF1).toBeCloseTo((0.5 + 0.5 + 2 / 3 + 0) / 4);
  });

  it("counts failures and rejects mismatched lengths", () => {
    const m = computeMetrics(["dlc"], [{ label: "unknown", error: "boom" }]);
    expect(m.failures).toBe(1);
    expect(() => computeMetrics(["dlc"], [])).toThrow();
  });
});

describe("runBenchmark", () => {
  it("trains on the train part only and scores the others", async () => {
    const records = toyRecords();
    const tfidf = new TfidfClassifier({ titleAware: false, seed: 1, threshold: 0 });
    const train = vi.spyOn(tfidf, "train");
    const result = await runBenchmark(records, [tfidf], { seed: 3 });
    const split = groupedSplit(records, 3);
    expect(train).toHaveBeenCalledWith(split.train);
    expect(result.dataset.split.train).toBe(split.train.length);
    const entry = result.classifiers[0];
    expect(entry?.metrics.test.n).toBe(split.test.length);
    expect(entry?.metrics.test.accuracy ?? 0).toBeGreaterThan(0.8);
  });

  it("turns a throwing classifier into counted abstentions", async () => {
    const broken: BenchClassifier = {
      id: "broken",
      trainable: false,
      remote: true,
      async classify() {
        throw new Error("provider down");
      },
    };
    const result = await runBenchmark(toyRecords(), [broken], { seed: 3 });
    const entry = result.classifiers[0];
    expect(entry?.metrics.test.failures).toBe(entry?.metrics.test.n);
    expect(entry?.testPredictions.every((p) => p.predicted === "unknown")).toBe(true);
    expect(entry?.usage.costCredits).toBeNull();
  });

  it("refuses to classify with an untrained model", async () => {
    const tfidf = new TfidfClassifier({ titleAware: false, seed: 1, threshold: 0.5 });
    await expect(tfidf.classify(release("a", "b", "dlc"))).rejects.toThrow(/trained/);
  });
});

describe("remote classifiers", () => {
  afterEach(() => vi.unstubAllGlobals());
  const row = release("Game.Update.v1-GRP", "Game", "patch");

  it("maps Jev's labels and survives an HTTP failure", async () => {
    expect(mapJevChoice("update")).toBe("patch");
    expect(mapJevChoice("repack")).toBe("full_game");
    expect(mapJevChoice("crack_only")).toBe("unknown");
    expect(mapJevChoice("nonsense")).toBeNull();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ answers: { releaseType: { choice: "update", confidence: 0.9 } } })
        )
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const jev = jevClassifier({
      url: "https://example.test",
      apiKey: "k",
      model: "m",
      maxCalls: 5,
    });
    expect(await jev.classify(row)).toMatchObject({ label: "patch", confidence: 0.9 });
    expect(await jev.classify(row)).toMatchObject({ label: "unknown", error: "HTTP 500" });
  });

  it("stops at the call budget without calling the network again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ answers: { releaseType: { choice: "dlc", confidence: 1 } } }))
      );
    vi.stubGlobal("fetch", fetchMock);
    const jev = jevClassifier({
      url: "https://example.test",
      apiKey: "k",
      model: "m",
      maxCalls: 1,
    });
    await jev.classify(row);
    const second = await jev.classify(row);
    expect(second.error).toBe(BUDGET_EXHAUSTED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("parses chat answers and records the cost the provider reports", async () => {
    expect(parseChatAnswer('```json\n{"label":"dlc","confidence":0.8}\n```')).toEqual({
      label: "dlc",
      confidence: 0.8,
    });
    expect(parseChatAnswer("not json")).toBeNull();
    expect(parseChatAnswer('{"label":"movie"}')).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"label":"patch","confidence":0.7}' } }],
            usage: { prompt_tokens: 100, completion_tokens: 8, cost: 0.0002 },
          })
        )
      )
    );
    const model = openRouterClassifier({ model: "vendor/model", apiKey: "k", maxCalls: 3 });
    expect(model.id).toBe("openrouter:vendor/model");
    expect(await model.classify(row)).toMatchObject({
      label: "patch",
      costCredits: 0.0002,
      promptTokens: 100,
      completionTokens: 8,
    });
  });

  it("reports cost as unavailable, not zero, when the provider omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ choices: [{ message: { content: '{"label":"dlc"}' } }] }))
        )
    );
    const model = openRouterClassifier({ model: "m", apiKey: "k", maxCalls: 3 });
    const prediction = await model.classify(row);
    expect(prediction.costCredits).toBeNull();
  });
});

describe("usage accounting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts only the requests that were sent, not the rows the call cap stopped", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ answers: { releaseType: { choice: "dlc", confidence: 1 } } }))
      );
    vi.stubGlobal("fetch", fetchMock);
    const jev = jevClassifier({
      url: "https://example.test",
      apiKey: "k",
      model: "m",
      maxCalls: 5,
    });
    const result = await runBenchmark(toyRecords(), [jev], { seed: 3 });
    const entry = result.classifiers[0];
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(entry?.usage.calls).toBe(5);
    expect(entry?.metrics.test.failures).toBeGreaterThan(0);
  });
});
