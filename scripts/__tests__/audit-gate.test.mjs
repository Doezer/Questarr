import { describe, it, expect } from "vitest";
import {
  collectVexAllowlist,
  evaluate,
  extractAdvisoryIds,
  normalizeAdvisoryId,
} from "../audit-gate.mjs";

function vuln(name, severity, via, extra = {}) {
  return { name, severity, via, range: "*", ...extra };
}

function ghsaVuln(name, severity, ghsaId, extra = {}) {
  return vuln(
    name,
    severity,
    [
      {
        title: ghsaId,
        url: `https://github.com/advisories/${ghsaId}`,
        severity,
      },
    ],
    extra
  );
}

describe("normalizeAdvisoryId", () => {
  it("uppercases and trims GHSA and CVE ids", () => {
    expect(normalizeAdvisoryId("ghsa-86w9-cpqp-85rv")).toBe("GHSA-86W9-CPQP-85RV");
    expect(normalizeAdvisoryId(" cve-2026-33894 ")).toBe("CVE-2026-33894");
  });

  it("rejects empty input and returns non-matching ids uppercased", () => {
    expect(normalizeAdvisoryId("")).toBeNull();
    expect(normalizeAdvisoryId(null)).toBeNull();
    expect(normalizeAdvisoryId("whatever")).toBe("WHATEVER");
  });
});

describe("collectVexAllowlist", () => {
  it("collects ids and aliases from not_affected and fixed statements only", () => {
    const feed = {
      statements: [
        {
          vulnerability: { "@id": "ghsa-aaaa-bbbb-cccc", aliases: ["cve-2026-1111"] },
          product: { "@id": "pkg:npm/x" },
          status: "not_affected",
        },
        {
          vulnerability: { "@id": "GHSA-1111-2222-3333" },
          product: { "@id": "pkg:npm/y" },
          status: "fixed",
        },
        {
          vulnerability: { "@id": "GHSA-9999-8888-7777" },
          product: { "@id": "pkg:npm/z" },
          status: "affected",
        },
        {
          vulnerability: { "@id": "GHSA-0000-1111-2222" },
          product: { "@id": "pkg:npm/w" },
          status: "under_investigation",
        },
      ],
    };
    const allowlist = collectVexAllowlist(feed);
    expect(allowlist.has("GHSA-AAAA-BBBB-CCCC")).toBe(true);
    expect(allowlist.has("CVE-2026-1111")).toBe(true);
    expect(allowlist.has("GHSA-1111-2222-3333")).toBe(true);
    expect(allowlist.has("GHSA-9999-8888-7777")).toBe(false);
    expect(allowlist.has("GHSA-0000-1111-2222")).toBe(false);
  });

  it("throws on malformed feeds instead of passing silently", () => {
    expect(() => collectVexAllowlist(null)).toThrow(/not a JSON object/);
    expect(() => collectVexAllowlist({})).toThrow(/no statements array/);
    expect(() => collectVexAllowlist({ statements: "nope" })).toThrow(/no statements array/);
  });
});

describe("extractAdvisoryIds", () => {
  it("pulls GHSA ids from advisory URLs and ignores plain-string via entries", () => {
    const v = vuln("pkg", "high", [
      "parent-package",
      { url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
    ]);
    expect([...extractAdvisoryIds(v)]).toEqual(["GHSA-AAAA-BBBB-CCCC"]);
  });

  it("extracts CVE ids from NVD-style URLs", () => {
    const v = vuln("pkg", "high", [{ url: "https://nvd.nist.gov/vuln/detail/CVE-2026-33894" }]);
    expect([...extractAdvisoryIds(v)]).toEqual(["CVE-2026-33894"]);
  });

  it("returns an empty set when no via entry carries an advisory URL", () => {
    expect(extractAdvisoryIds(vuln("pkg", "high", ["other-pkg"])).size).toBe(0);
    expect(extractAdvisoryIds(vuln("pkg", "high", [])).size).toBe(0);
  });
});

describe("evaluate", () => {
  const emptyAllowlist = new Set();

  it("passes a clean audit report", () => {
    const result = evaluate({ vulnerabilities: {} }, emptyAllowlist);
    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toEqual([]);
  });

  it("blocks a high finding with no VEX statement", () => {
    const result = evaluate(
      { vulnerabilities: { "node-forge": ghsaVuln("node-forge", "high", "GHSA-86w9-cpqp-85rv") } },
      emptyAllowlist
    );
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].name).toBe("node-forge");
    expect(result.blocking[0].reason).toContain("GHSA-86W9-CPQP-85RV");
  });

  it("suppresses a high finding covered by a VEX statement", () => {
    const result = evaluate(
      { vulnerabilities: { "node-forge": ghsaVuln("node-forge", "high", "ghsa-86w9-cpqp-85rv") } },
      new Set(["GHSA-86W9-CPQP-85RV"])
    );
    expect(result.blocking).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].reason).toBe("covered by the VEX feed");
  });

  it("suppresses via an alias (CVE) when the primary id is a GHSA", () => {
    const v = vuln("node-forge", "high", [
      { url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv" },
    ]);
    const result = evaluate(
      { vulnerabilities: { "node-forge": v } },
      new Set(["CVE-2026-33894"]) // only the alias present
    );
    // The GHSA id itself is not in the allowlist, so only a feed containing
    // the GHSA id (or both) suppresses it.
    expect(result.blocking).toHaveLength(1);
  });

  it("blocks when only some of a finding's advisories are covered", () => {
    const v = vuln("pkg", "critical", [
      { url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
      { url: "https://github.com/advisories/GHSA-1111-2222-3333" },
    ]);
    const result = evaluate({ vulnerabilities: { pkg: v } }, new Set(["GHSA-AAAA-BBBB-CCCC"]));
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].reason).toContain("GHSA-1111-2222-3333");
  });

  it("fails closed on a critical finding without any advisory id", () => {
    const result = evaluate(
      { vulnerabilities: { pkg: vuln("pkg", "critical", ["other-pkg"]) } },
      new Set(["GHSA-AAAA-BBBB-CCCC"])
    );
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].reason).toContain("no advisory ID");
  });

  it("never blocks moderate/low findings", () => {
    const result = evaluate(
      {
        vulnerabilities: {
          a: ghsaVuln("a", "moderate", "GHSA-aaaa-bbbb-cccc"),
          b: ghsaVuln("b", "low", "GHSA-1111-2222-3333"),
          c: ghsaVuln("c", "info", "GHSA-9999-8888-7777"),
        },
      },
      emptyAllowlist
    );
    expect(result.blocking).toEqual([]);
    expect(result.nonBlocking).toHaveLength(3);
  });
});
