import { describe, it, expect } from "vitest";
import { evaluateRelease, type ReleaseInput } from "../release-scoring";
import { deriveReleaseTrust } from "../release-trust";

const GB = 1024 ** 3;
const input = (title: string, size = 5 * GB): ReleaseInput => ({
  title,
  downloadType: "torrent",
  size,
  seeders: 5,
  category: ["4000"],
});

function trustOf(
  title: string,
  ctx: Parameters<typeof evaluateRelease>[1],
  signals: Parameters<typeof deriveReleaseTrust>[1] = {},
  size = 5 * GB
) {
  const evaluation = evaluateRelease(input(title, size), ctx);
  return deriveReleaseTrust(evaluation, { size, ...signals });
}

const game = { gameTitle: "Elden Ring" };

describe("deriveReleaseTrust", () => {
  it("trusts an xREL listing whose size agrees", () => {
    const trust = trustOf("Elden.Ring-RUNE", {
      ...game,
      xrelReleases: [{ dirname: "Elden.Ring-RUNE", sizeBytes: 5.2 * GB }],
    });
    expect(trust.level).toBe("trusted");
    expect(trust.reasons.map((r) => r.code)).toContain("xrel_verified");
  });

  it("does not trust a name that is only on xREL (anyone can reuse a scene name)", () => {
    const trust = trustOf("Elden.Ring-RUNE", {
      ...game,
      xrelReleases: [{ dirname: "Elden.Ring-RUNE" }],
    });
    expect(trust.level).toBe("unverified");
  });

  it("flags an xREL name with a size that does not match", () => {
    const trust = trustOf("Elden.Ring-RUNE", {
      ...game,
      xrelReleases: [{ dirname: "Elden.Ring-RUNE", sizeBytes: 50 * GB }],
    });
    expect(trust.level).toBe("unverified");
    expect(trust.reasons.map((r) => r.code)).toContain("xrel_size_mismatch");
  });

  it("does not let a preferred group outweigh an xREL size mismatch", () => {
    const trust = trustOf(
      "Elden.Ring-RUNE",
      { ...game, xrelReleases: [{ dirname: "Elden.Ring-RUNE", sizeBytes: 50 * GB }] },
      { preferredGroup: true }
    );
    expect(trust.level).toBe("unverified");
  });

  it("is risky when nuked, whatever else is positive", () => {
    const trust = trustOf(
      "Elden.Ring-RUNE",
      { ...game, xrelReleases: [{ dirname: "Elden.Ring-RUNE", nukeReason: "fake" }] },
      { preferredGroup: true }
    );
    expect(trust.level).toBe("risky");
    expect(trust.reasons.find((r) => r.code === "xrel_nuked")?.detail).toBe("fake");
  });

  it("is risky for an executable payload and for a blacklisted release", () => {
    expect(trustOf("Elden Ring Setup.exe", game).level).toBe("risky");
    expect(trustOf("Elden.Ring-RUNE", game, { blacklisted: true }).level).toBe("risky");
  });

  it("stays unverified when xREL could not be checked, even for a preferred group", () => {
    const trust = trustOf(
      "Elden.Ring-RUNE",
      { ...game, xrelUnavailable: true },
      { preferredGroup: true }
    );
    expect(trust.level).toBe("unverified");
    expect(trust.reasons.map((r) => r.code)).toContain("xrel_unavailable");
  });

  it("trusts a preferred group when xREL has no opinion", () => {
    expect(trustOf("Elden.Ring-RUNE", game, { preferredGroup: true }).level).toBe("trusted");
    expect(
      trustOf("Elden.Ring-RUNE", { ...game, xrelReleases: [] }, { preferredGroup: true }).level
    ).toBe("trusted");
  });

  it("is unverified with no positive signal", () => {
    expect(trustOf("Elden.Ring-RUNE", game).level).toBe("unverified");
    expect(trustOf("Elden.Ring-RUNE", { ...game, xrelReleases: [] }).level).toBe("unverified");
  });

  it("does not trust a release for another game or a sequel", () => {
    const trust = trustOf("Dark.Souls-RUNE", game, { preferredGroup: true });
    expect(trust.level).toBe("unverified");
    expect(trust.reasons.map((r) => r.code)).toContain("rejected");
  });
});
