import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIZARD_ANSWERS,
  INITIAL_WIZARD_REVISION,
  WIZARD_REVISION,
  WIZARD_STEPS,
  inferWizardAnswers,
  wizardStepsSince,
  visibleWizardSteps,
  type WizardAnswers,
} from "../setup-wizard";

const ids = (answers: WizardAnswers, configured = {}, only = false) =>
  visibleWizardSteps(answers, configured, only).map((s) => s.id);

describe("visibleWizardSteps", () => {
  it("shows only the common steps when nothing is used", () => {
    expect(ids(DEFAULT_WIZARD_ANSWERS)).toEqual([
      "questions",
      "igdb",
      "platforms",
      "privacy",
      "summary",
    ]);
  });

  it("adds the download steps only when Questarr downloads", () => {
    const steps = ids({ ...DEFAULT_WIZARD_ANSWERS, download: true });
    expect(steps).toEqual(
      expect.arrayContaining(["indexers", "downloaders", "automation", "import"])
    );
    expect(ids(DEFAULT_WIZARD_ANSWERS)).not.toContain("indexers");
  });

  it("offers an achievement service for each platform picked, and no other", () => {
    const answers = { ...DEFAULT_WIZARD_ANSWERS, platforms: ["xbox", "playstation"] } as const;
    const steps = ids({ ...answers, platforms: [...answers.platforms] });
    expect(steps).toContain("xbox");
    expect(steps).toContain("psn");
    expect(steps).not.toContain("steam");
    expect(steps).not.toContain("retroachievements");
  });

  it("offers Steam and NexusMods for PC and RetroAchievements for retro", () => {
    expect(ids({ ...DEFAULT_WIZARD_ANSWERS, platforms: ["pc"] })).toEqual(
      expect.arrayContaining(["steam", "nexusmods"])
    );
    expect(ids({ ...DEFAULT_WIZARD_ANSWERS, platforms: ["retro"] })).toContain("retroachievements");
  });

  it("shows notifications only when asked for", () => {
    expect(ids(DEFAULT_WIZARD_ANSWERS)).not.toContain("notifications");
    expect(ids({ ...DEFAULT_WIZARD_ANSWERS, notifications: true })).toContain("notifications");
  });

  it("drops configured steps when only unconfigured ones are wanted, but never the fixed ones", () => {
    const answers: WizardAnswers = { platforms: ["pc"], download: true, notifications: false };
    const steps = ids(answers, { igdb: true, steam: true, questions: true, summary: true }, true);
    expect(steps).not.toContain("igdb");
    expect(steps).not.toContain("steam");
    expect(steps).toContain("questions");
    expect(steps).toContain("summary");
    expect(steps).toContain("indexers");
  });
});

describe("inferWizardAnswers", () => {
  it("guesses platforms and download use from what is configured", () => {
    expect(inferWizardAnswers({ steam: true, indexers: true, psn: true })).toEqual({
      platforms: ["pc", "playstation"],
      download: true,
      notifications: false,
    });
  });
});

describe("wizard revisions", () => {
  it("is the newest step revision, so an up to date install has nothing new", () => {
    expect(WIZARD_REVISION).toBe(Math.max(...WIZARD_STEPS.map((s) => s.since)));
    expect(wizardStepsSince(WIZARD_REVISION)).toEqual([]);
  });

  it("lists the steps added after the revision the user saw", () => {
    const added = wizardStepsSince(INITIAL_WIZARD_REVISION).map((s) => s.id);
    expect(added).toEqual(expect.arrayContaining(["xbox", "psn"]));
    expect(added).not.toContain("igdb");
  });

  it("can be limited to the steps that can be shown", () => {
    expect(
      wizardStepsSince(INITIAL_WIZARD_REVISION, (id) => id === "xbox").map((s) => s.id)
    ).toEqual(["xbox"]);
  });
});
