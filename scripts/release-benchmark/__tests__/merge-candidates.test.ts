import { describe, it, expect } from "vitest";
import { importDataset } from "../dataset.js";
import { mergeCandidates } from "../merge-candidates.js";

const DATASET = [
  "release_name,query,human_label,notes",
  "Stellaris Update v3.4,Stellaris,patch,",
  "Stellaris Galactic Edition,Stellaris,full_game,",
  "",
].join("\n");
const header = "release_name,query,human_label,notes\n";

describe("mergeCandidates", () => {
  it("appends new verified rows and keeps the existing text untouched", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      incoming: `${header}Stellaris Leviathans Story Pack,Stellaris,dlc,from review\n`,
    });
    expect(report.added).toEqual(["Stellaris Leviathans Story Pack"]);
    expect(report.csv.startsWith(DATASET)).toBe(true);
    const merged = importDataset(report.csv, "csv").records;
    expect(merged).toHaveLength(3);
    expect(merged.at(-1)).toMatchObject({ label: "dlc", notes: "from review" });
  });

  it("does not duplicate a release already labeled the same way", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      incoming: `${header}stellaris  update v3.4,STELLARIS,patch,\n`.replace("  ", " "),
    });
    expect(report.duplicates).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    expect(report.csv).toBe(DATASET);
  });

  it("reports a different label as a conflict and never overwrites", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      incoming: `${header}Stellaris Update v3.4,Stellaris,dlc,\n`,
    });
    expect(report.conflicts).toEqual([
      { releaseName: "Stellaris Update v3.4", gameTitle: "Stellaris", labels: ["patch", "dlc"] },
    ]);
    expect(report.csv).toBe(DATASET);
  });

  it("reports contradictory rows inside the incoming file and adds neither", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      incoming: `${header}New Pack,Stellaris,dlc,\nNew Pack,Stellaris,patch,\n`,
    });
    expect(report.conflicts).toHaveLength(1);
    expect(report.added).toHaveLength(0);
  });

  it("keeps rows of held-out games out of the training dataset", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      heldout: `${header}Hades Update 1.2,Hades,patch,\n`,
      incoming: `${header}Hades Bonus Pack,Hades,dlc,\nStellaris Apocalypse,Stellaris,dlc,\n`,
    });
    expect(report.heldOut).toEqual(["Hades Bonus Pack"]);
    expect(report.added).toEqual(["Stellaris Apocalypse"]);
    expect(report.csv).not.toContain("Hades");
  });

  it("counts rows without a game or label as invalid", () => {
    const report = mergeCandidates({
      dataset: DATASET,
      incoming: `${header}No Game,,dlc,\nNo Label,Stellaris,,\n`,
    });
    expect(report.invalid).toBe(2);
    expect(report.added).toHaveLength(0);
  });

  it("follows the dataset's own column names and order", () => {
    const report = mergeCandidates({
      dataset: "notes,label,game_title,release_name\n,patch,Hades,Hades Update 1\n",
      incoming: `${header}Hades Update 2,Hades,patch,ok\n`,
    });
    expect(report.csv.trim().split("\n").at(-1)).toBe("ok,patch,Hades,Hades Update 2");
  });
});
