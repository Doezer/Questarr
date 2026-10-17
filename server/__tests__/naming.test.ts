import { describe, it, expect } from "vitest";
import {
  buildNamingContext,
  DEFAULT_NAMING_PATTERN,
  renderName,
  renderNameOrFallback,
  validatePattern,
} from "../../shared/naming.js";
import { sanitizeFsName } from "../services/ImportStrategies.js";

const ctx = {
  title: "The Witcher 3: Wild Hunt",
  year: "2015-05-19",
  platform: "PC",
  version: "v1.32",
  group: "GOG",
  source: "GOG",
  igdbId: 1942,
  steamAppId: 292030,
};

describe("naming engine", () => {
  it("renders every token", () => {
    expect(renderName("{Title} ({Year}) [{Group}]", ctx)).toBe(
      "The Witcher 3_ Wild Hunt (2015) [GOG]"
    );
    expect(renderName("{TitleThe}", ctx)).toBe("Witcher 3_ Wild Hunt, The");
    expect(renderName("{Platform} {Version} {Source} {IgdbId} {SteamAppId}", ctx)).toBe(
      "PC v1.32 GOG 1942 292030"
    );
  });

  it("drops empty brackets and orphan separators", () => {
    const bare = { title: "Hades" };
    expect(renderName("{Title} ({Year}) [{Group}]", bare)).toBe("Hades");
    expect(renderName("{Title} - {Group}", bare)).toBe("Hades");
    expect(renderName("{Group} - {Title}", bare)).toBe("Hades");
    expect(renderName("{Title} {Version} {Year}", { title: "Hades", year: 2020 })).toBe(
      "Hades 2020"
    );
  });

  it("keeps the default pattern identical to the historical file name", () => {
    for (const title of [
      "Half-Life: Alyx",
      "Hades",
      "  Spaced  Out  ",
      "What/Ever?",
      "Cyberpunk 2077",
      "Ōkami HD",
    ]) {
      expect(renderName(DEFAULT_NAMING_PATTERN, { title })).toBe(sanitizeFsName(title));
    }
  });

  it("neutralises hostile release data", () => {
    const hostile = buildNamingContext({ title: "Hades" }, "PC", "Hades-..\\..\\evil/x:y\u0000");
    const out = renderName("{Title} [{Group}]", { ...hostile, group: "../../etc\\x:\u0000" });
    expect(out).not.toMatch(/[/\\:\u0000]/);
  });

  it("prefixes Windows reserved names and rejects dot names", () => {
    expect(renderName("{Title}", { title: "CON" })).toBe("_CON");
    expect(renderName("{Title}", { title: ".." })).toBe("");
    expect(renderNameOrFallback("{Title}", { title: ".." })).toBe("Unknown");
  });

  it("caps the name at 200 UTF-8 bytes without splitting a character", () => {
    const out = renderName("{Title}", { title: "é".repeat(150) });
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(200);
    expect(out).toBe("é".repeat(100));
    const emoji = renderName("{Title}", { title: "👨‍👩‍👧".repeat(30) });
    expect(emoji.length % "👨‍👩‍👧".length).toBe(0);
  });

  it("validates patterns", () => {
    expect(validatePattern("{Title} ({Year})").ok).toBe(true);
    expect(validatePattern("{title}").ok).toBe(true);
    expect(validatePattern("{Foo}").errors).toContain("Unknown token {Foo}");
    expect(validatePattern("../{Title}").ok).toBe(false);
    expect(validatePattern("a/{Title}").ok).toBe(false);
    expect(validatePattern("C:\\{Title}").ok).toBe(false);
    expect(validatePattern("{Title").ok).toBe(false);
    expect(validatePattern("{{Title}}").ok).toBe(false);
    expect(validatePattern("{Title}\u0000").ok).toBe(false);
  });

  it("drops a bracket group whose tokens are all empty, separators included", () => {
    const bare = { title: "Hades" };
    expect(renderName("{Title} [{Version}-{Group}]", bare)).toBe("Hades");
    expect(renderName("[{Version}-{Group}]", bare)).toBe("");
    expect(renderName("{Title} [{Version}-{Group}]", { title: "Hades", group: "FLT" })).toBe(
      "Hades [-FLT]"
    );
  });

  it("sanitizes illegal literal characters of the pattern", () => {
    expect(renderName("{Title}: {Year}?", { title: "Hades", year: 2020 })).toBe("Hades_ 2020_");
  });

  it("normalizes fallback names like rendered ones", () => {
    expect(renderNameOrFallback("{Year}", { title: "CON" })).toBe("_CON");
    expect(renderNameOrFallback("{Year}", { title: "Game." })).toBe("Game");
    const long = renderNameOrFallback("{Year}", { title: "x".repeat(500) });
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(200);
  });

  it("falls back to the title for an invalid pattern", () => {
    expect(renderNameOrFallback("{Foo}", { title: "Hades" })).toBe("Hades");
  });

  it("builds the context from the release name", () => {
    const built = buildNamingContext(
      { title: "Hades", releaseDate: "2020-09-17", igdbId: 5 },
      "PC",
      "Hades.v1.38290-GOG"
    );
    expect(built.year).toBe("2020-09-17");
    expect(built.group).toBe("GOG");
    expect(built.version).toBeTruthy();
  });
});
