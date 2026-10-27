import { describe, it, expect } from "vitest";
import { importDataset, normalizeLabel, parseCsv } from "../dataset.js";

describe("parseCsv", () => {
  it("handles BOM, quoted fields, doubled quotes, CRLF and a semicolon delimiter", () => {
    const rows = parseCsv('﻿a;b\r\n"x;y";"say ""hi"""\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x;y", 'say "hi"'],
    ]);
  });

  it("keeps decimal commas inside quotes with a comma delimiter", () => {
    expect(parseCsv('n,c\nrel,"0,87"\n')).toEqual([
      ["n", "c"],
      ["rel", "0,87"],
    ]);
  });
});

describe("normalizeLabel", () => {
  it("folds Jev's vocabulary onto the ADR classes and flags", () => {
    expect(normalizeLabel("expansion")).toEqual({ label: "dlc", flags: [] });
    expect(normalizeLabel("update")).toEqual({ label: "patch", flags: [] });
    expect(normalizeLabel("dlc_update")).toEqual({ label: "patch", flags: [] });
    expect(normalizeLabel("repack")).toEqual({ label: "full_game", flags: ["repack"] });
    expect(normalizeLabel("Other")).toEqual({ label: "unknown", flags: ["other_artifact"] });
    expect(normalizeLabel("crack_only")).toEqual({ label: "unknown", flags: ["crack_only"] });
  });

  it("rejects labels outside the vocabulary", () => {
    expect(normalizeLabel("movie")).toBeNull();
  });
});

describe("importDataset", () => {
  const header = "release_name,query,human_label,notes\n";

  it("reports unlabeled, malformed, duplicate and conflicting rows", () => {
    const csv =
      header +
      [
        "A.Game-GRP,A Game,full_game,",
        "a.game-grp,A Game,full_game,",
        "B.Game.Update-GRP,B Game,patch,",
        "B.Game.Update-GRP,B Game,dlc,",
        "C.Game-GRP,C Game,,",
        "D.Game-GRP,D Game,banana,",
        ",E Game,dlc,",
      ].join("\n");
    const { records, issues } = importDataset(csv, "csv");
    expect(records.map((r) => r.releaseName)).toEqual(["A.Game-GRP"]);
    expect(issues.duplicates).toEqual(["A.Game-GRP"]);
    expect(issues.conflicts).toEqual([
      { releaseName: "B.Game.Update-GRP", gameTitle: "B Game", labels: ["patch", "dlc"] },
    ]);
    expect(issues.unlabeled.map((u) => u.reason)).toEqual([
      "empty label",
      'unknown label "banana"',
    ]);
    expect(issues.malformed).toBe(1);
  });

  it("reads JSONL with either naming of the fields", () => {
    const jsonl = [
      JSON.stringify({ release_name: "X-GRP", game_title: "X", label: "dlc" }),
      JSON.stringify({ releaseName: "Y-GRP", query: "Y", human_label: "update", notes: "n" }),
    ].join("\n");
    const { records } = importDataset(jsonl, "jsonl");
    expect(records.map((r) => [r.releaseName, r.label])).toEqual([
      ["X-GRP", "dlc"],
      ["Y-GRP", "patch"],
    ]);
    expect(records[1]?.notes).toBe("n");
  });

  it("fails clearly on a CSV without the needed columns and on broken JSONL", () => {
    expect(() => importDataset("a,b\n1,2\n", "csv")).toThrow(/release_name/);
    expect(() => importDataset("{bad", "jsonl")).toThrow(/Line 1/);
  });
});
