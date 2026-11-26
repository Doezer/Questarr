import { describe, expect, it } from "vitest";
import { extractVersionFromReleaseName } from "../version-utils.js";
import { categorizeDownload } from "../download-categorizer.js";

/**
 * Corpus of release names as the common repack and scene groups write them, with the version
 * extractVersionFromReleaseName must read (null: the name carries none, or one that can't be
 * trusted). Grows with every name that was misread in the wild.
 */
interface Case {
  name: string;
  version: string | null;
}

const FITGIRL: Case[] = [
  {
    name: "Cyberpunk 2077: Ultimate Edition (v2.12 + All DLCs, MULTi18) [FitGirl Repack]",
    version: "v2.12",
  },
  {
    name: "Elden Ring: Deluxe Edition (v1.10.1 + DLC, MULTi14) [FitGirl Repack, Selective Download]",
    version: "v1.10.1",
  },
  {
    name: "Baldur's Gate 3: Digital Deluxe Edition (v4.1.1.3622478 + 4 DLCs/Bonuses, MULTi14) [FitGirl Repack]",
    version: "v4.1.1.3622478",
  },
  {
    name: "The Witcher 3: Wild Hunt - Complete Edition (v4.04 + 18 DLCs, MULTi15) [FitGirl Repack]",
    version: "v4.04",
  },
  { name: "Hades (Build 1.38290 + Bonus Content, MULTi8) [FitGirl Repack]", version: null },
  { name: "Stardew Valley (v1.6.15 + Bonus OST, MULTi12) [FitGirl Repack]", version: "v1.6.15" },
  {
    name: "Dark Souls III: Deluxe Edition (v1.15.2 + 2 DLCs, MULTi10) [FitGirl Repack]",
    version: "v1.15.2",
  },
  {
    name: "Starfield: Digital Premium Edition (v1.14.70 + Shattered Space DLC) [FitGirl Repack]",
    version: "v1.14.70",
  },
];

const DODI: Case[] = [
  { name: "Cyberpunk 2077 Phantom Liberty (v2.1 + All DLCs) [DODI Repack]", version: "v2.1" },
  { name: "Resident Evil 4 Remake (v1.1.0 + DLC) [DODI Repack]", version: "v1.1.0" },
  {
    name: "Hogwarts Legacy Deluxe Edition (Build 12078343 + Bonus) [DODI Repack]",
    version: "Build 12078343",
  },
  { name: "Palworld (v0.3.8 + Early Access) [DODI Repack]", version: "v0.3.8" },
  { name: "Red Dead Redemption 2 (v1491.50 + Bonus Content) [DODI Repack]", version: "v1491.50" },
  { name: "Sekiro Shadows Die Twice GOTY Edition (v1.06) [DODI Repack]", version: "v1.06" },
];

const SCENE: Case[] = [
  { name: "Cyberpunk.2077.v2.12-GOG", version: "v2.12" },
  { name: "Elden.Ring.v1.10.1-RUNE", version: "v1.10.1" },
  { name: "Hades.Build.12345678-TENOKE", version: "Build 12345678" },
  { name: "Stardew.Valley.v1.6.15-GOG", version: "v1.6.15" },
  { name: "The.Witcher.3.Wild.Hunt.Complete.Edition.v4.04-GOG", version: "v4.04" },
  { name: "Game.Name.v1.2.3.Update.Only-SKIDROW", version: null },
  { name: "Game.Name.Update.v1.0.to.v1.1-RUNE", version: "v1.1" },
  { name: "Game.Name.Update.Build.1000.to.Build.1200-TENOKE", version: "Build 1200" },
  { name: "Game.Name.Hotfix.v1.2-SKIDROW", version: null },
  { name: "Game.Name.v1.2.Beta-CODEX", version: null },
  { name: "Game.Name.v20231005-PLAZA", version: "v20231005" },
  { name: "Game.Name.Build.1491.50-FLT", version: null },
];

const OTHER_REPACKERS: Case[] = [
  { name: "Elden Ring v1.10.1 [GOG] (ElAmigos)", version: "v1.10.1" },
  { name: "Game.v1.2.3.4.Multi10-ELAMIGOS", version: "v1.2.3.4" },
  { name: "Elden Ring (v1.10.1) [Steam Rip] [KaOs Repack]", version: "v1.10.1" },
  { name: "Hollow Knight v1.5.78.11833 (GOG) [Gnarly Repacks]", version: "v1.5.78.11833" },
  { name: "Terraria v1.4.4.9 [GOG-Games]", version: "v1.4.4.9" },
  { name: "Game Name v1.2.3 + 5 DLCs, Windows 10 [Xatab]", version: "v1.2.3" },
  { name: "Game.Name.v1.0.0.12345.Linux-GOG", version: "v1.0.0.12345" },
  { name: "Fallout 4 v1.10.163 + GOTY", version: "v1.10.163" },
  { name: "Game Name 2 v1.0-RUNE", version: "v1.0" },
  // A version and a build number side by side: the version wins.
  { name: "Game Name (v1.0.5 build 123456) [FitGirl Repack]", version: "v1.0.5" },
];

// Names where the version can't be trusted: extraction must stay null so the auto-grab never
// compares against a guess.
const UNTRUSTWORTHY: Case[] = [
  { name: "Elden Ring [Repack by Xatab]", version: null },
  { name: "Stardew Valley v1.6.15 hotfix", version: null },
  { name: "Game Name v2.0 Hotfix 3 [DODI Repack]", version: null },
  { name: "Game v1.2a-GOG", version: null },
  { name: "Game Name Version 1.2.3 [Portable]", version: null },
  { name: "Game Name Update 3 + DLC [FitGirl]", version: null },
  { name: "Game Name v0.9.1 Early Access (Build 12345) [KaOs]", version: null },
  { name: "Game Name 1.2.3.4-I_KnoW", version: null },
];

describe.each([
  ["FitGirl", FITGIRL],
  ["DODI", DODI],
  ["scene", SCENE],
  ["other repackers", OTHER_REPACKERS],
  ["untrustworthy", UNTRUSTWORTHY],
])("version extraction: %s releases", (_group, cases) => {
  it.each(cases)("reads $name", ({ name, version }) => {
    expect(extractVersionFromReleaseName(name)).toBe(version);
  });
});

describe("update-only releases", () => {
  it.each([
    "Game.Name.Update.v1.0.to.v1.1-RUNE",
    "Game.Name.Update.Build.1000.to.Build.1200-TENOKE",
    "Game Name (Update v1.1) [DODI Repack]",
    "Game Name - Update 5 (v1.5) [FitGirl Repack]",
  ])("is filed as an update: %s", (name) => {
    expect(categorizeDownload(name).category).toBe("update");
  });
});
