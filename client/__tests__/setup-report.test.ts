import { describe, expect, it } from "vitest";
import { buildRedactedReport, type SetupCheckReport } from "@/lib/setup-report";

const report: SetupCheckReport = {
  generatedAt: "2026-11-20T10:00:00.000Z",
  summary: { pass: 1, warn: 0, fail: 1, skip: 0 },
  checks: [
    { id: "library-root", group: "paths", title: "Library root", status: "pass", message: "ok" },
    {
      id: "indexer-a",
      group: "indexers",
      title: "My Private Tracker",
      status: "fail",
      message: "connect ECONNREFUSED 192.168.1.20:9696",
      fix: "Check the URL.",
    },
  ],
};

describe("buildRedactedReport", () => {
  const text = buildRedactedReport(report);
  it("hides indexer names and IP addresses", () => {
    expect(text).not.toContain("My Private Tracker");
    expect(text).not.toContain("192.168.1.20");
    expect(text).toContain("Indexer #1");
  });
  it("keeps statuses and fixes", () => {
    expect(text).toContain("[FAIL]");
    expect(text).toContain("Fix: Check the URL.");
    expect(text).toContain("1 failed");
  });
});

describe("hostname redaction", () => {
  it("masks hostnames and URLs in messages", () => {
    const text = buildRedactedReport({
      ...report,
      checks: [
        {
          id: "service-clamav",
          group: "tools",
          title: "ClamAV",
          status: "fail",
          message:
            "Failed to resolve hostname: seedbox; GET https://tracker.example.org/api failed",
        },
      ],
    });
    expect(text).not.toContain("seedbox");
    expect(text).not.toContain("tracker.example.org");
  });
});
