import { describe, expect, it } from "vitest";
import { summarizeErrors, type ErrorGroup } from "../log-summary";
import {
  buildReportEnvelope,
  buildReportLabels,
  buildReportTitle,
  cleanNote,
  findDuplicateReport,
  hashText,
  rememberReport,
  reportSignature,
} from "../support-report";

const group = (overrides: Partial<ErrorGroup> = {}): ErrorGroup => ({
  count: 3,
  module: "downloaders",
  message: "Download check failed: Error ECONNREFUSED: connect refused",
  firstSeen: "2026-11-26T10:00:00.000Z",
  lastSeen: "2026-11-26T10:05:00.000Z",
  ...overrides,
});

describe("report title and labels", () => {
  it("signs the title with trigger, version and the top error", () => {
    const meta = {
      trigger: "auto" as const,
      appVersion: "1.7.0",
      platform: "server",
      groups: [group()],
    };
    expect(buildReportTitle(meta)).toBe(
      "Error report v1.7.0 - downloaders: Download check failed: Error ECONNREFUSED: connect refused"
    );
    expect(buildReportTitle({ ...meta, trigger: "manual", groups: [] })).toBe(
      "Support log v1.7.0 - no warnings or errors in logs"
    );
  });

  it("clips long titles and builds slug labels", () => {
    const long = group({ message: "x".repeat(400) });
    const meta = {
      trigger: "manual" as const,
      appVersion: "1.7.0",
      platform: "Mac OS",
      groups: [long],
    };
    expect(buildReportTitle(meta).length).toBeLessThanOrEqual(120);
    expect(buildReportLabels(meta)).toEqual([
      "trigger:manual",
      "version:1.7.0",
      "platform:mac-os",
      "module:downloaders",
    ]);
  });
});

describe("report signature", () => {
  it("ignores counts and timestamps but not the problem itself", () => {
    const a = reportSignature([group()]);
    const b = reportSignature([group({ count: 99, lastSeen: "2026-11-27T00:00:00.000Z" })]);
    const c = reportSignature([group({ message: "other failure" })]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("falls back to the log tail without timestamps when nothing failed", () => {
    const line = (time: string, msg: string) => JSON.stringify({ level: 30, time, msg });
    const first = reportSignature([], [line("2026-11-26T10:00:00.000Z", "hello")]);
    const again = reportSignature([], [line("2026-11-26T11:00:00.000Z", "hello")]);
    const different = reportSignature([], [line("2026-11-26T10:00:00.000Z", "bye")]);
    expect(first).toBe(again);
    expect(first).not.toBe(different);
  });

  it("hashes deterministically", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).toHaveLength(8);
  });
});

describe("report signature with many problems", () => {
  const entry = (i: number, times: number) =>
    Array.from({ length: times }, () =>
      JSON.stringify({ level: 50, module: "m", msg: `problem ${String(i).padStart(2, "0")}` })
    );
  const lines = (counts: number[]) => counts.flatMap((times, i) => entry(i, times));
  const base = Array.from({ length: 18 }, () => 3);

  it("does not change when counts move a problem across the display boundary", () => {
    const bumped = [...base];
    bumped[17] = 50; // would enter the top 10 / 15 by count
    expect(reportSignature(summarizeErrors(lines(bumped), Infinity))).toBe(
      reportSignature(summarizeErrors(lines(base), Infinity))
    );
  });

  it("changes when a problem beyond the display boundary changes", () => {
    const withoutLast = base.slice(0, 17);
    expect(reportSignature(summarizeErrors(lines(withoutLast), Infinity))).not.toBe(
      reportSignature(summarizeErrors(lines(base), Infinity))
    );
  });
});

describe("report envelope", () => {
  it("puts a deduplicated summary and the scrubbed note at the top", () => {
    const envelope = buildReportEnvelope({
      trigger: "manual",
      appVersion: "1.7.0",
      platform: "Linux",
      groups: [group()],
      note: "  I clicked   search at /home/alice/games on 192.168.1.5  ",
    });
    expect(envelope.header).toContain("=== ERROR SUMMARY");
    expect(envelope.header).toContain("3x [downloaders] Download check failed");
    expect(envelope.header).toContain(`Signature: ${envelope.signature}`);
    expect(envelope.header).not.toContain("alice");
    expect(envelope.header).not.toContain("192.168.1.5");
  });

  it("says so when there is nothing to summarize", () => {
    const envelope = buildReportEnvelope({
      trigger: "manual",
      appVersion: "1.7.0",
      platform: "Linux",
      groups: [],
    });
    expect(envelope.header).toContain("No warnings or errors in the attached logs.");
  });

  it("clips and cleans the note", () => {
    expect(cleanNote("   ")).toBe("");
    expect(cleanNote("a".repeat(5000)).length).toBeLessThanOrEqual(1000);
  });

  it("removes quoted paths with spaces and UNC shares from the note", () => {
    const quoted = cleanNote('Opened "/mnt/My Games/private" then crashed');
    expect(quoted).not.toContain("Games");
    expect(quoted).not.toContain("private");
    const unc = cleanNote(String.raw`Pointed it at \\NASBOX\Media\Games today`);
    expect(unc).not.toContain("NASBOX");
    expect(unc).not.toContain("Media");
    expect(cleanNote("Clicked search twice")).toBe("Clicked search twice");
  });
});

describe("duplicate suppression", () => {
  it("finds a recent identical report and forgets old ones", () => {
    const now = 10_000_000;
    const recent = rememberReport({ signature: "abc", sentAt: now - 1000, code: "123" }, []);
    expect(findDuplicateReport("abc", recent, now)?.code).toBe("123");
    expect(findDuplicateReport("other", recent, now)).toBeUndefined();
    expect(findDuplicateReport("abc", recent, now + 2 * 60 * 60 * 1000)).toBeUndefined();
    const pruned = rememberReport({ signature: "new", sentAt: now + 2 * 60 * 60 * 1000 }, recent);
    expect(pruned.map((entry) => entry.signature)).toEqual(["new"]);
  });
});
