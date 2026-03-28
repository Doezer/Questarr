/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import DownloadIndicator from "../src/components/DownloadIndicator";
import type { DownloadSummary } from "@shared/schema";

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("DownloadIndicator", () => {
  it("renders nothing when summary is undefined", () => {
    const { container } = render(<DownloadIndicator summary={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders blue dot for downloading status", () => {
    const summary: DownloadSummary = {
      topStatus: "downloading",
      count: 1,
      downloadTypes: ["torrent"],
    };
    render(<DownloadIndicator summary={summary} />);
    const dot = screen.getByRole("status");
    expect(dot.className).toContain("bg-blue-500");
  });

  it("renders emerald dot for completed status", () => {
    const summary: DownloadSummary = {
      topStatus: "completed",
      count: 1,
      downloadTypes: ["torrent"],
    };
    render(<DownloadIndicator summary={summary} />);
    const dot = screen.getByRole("status");
    expect(dot.className).toContain("bg-emerald-500");
  });

  it("tooltip shows count and types", () => {
    const summary: DownloadSummary = {
      topStatus: "downloading",
      count: 2,
      downloadTypes: ["torrent", "usenet"],
    };
    render(<DownloadIndicator summary={summary} />);
    const dot = screen.getByRole("status");
    expect(dot.getAttribute("aria-label")).toContain("2 downloads");
    expect(dot.getAttribute("aria-label")).toContain("torrent, usenet");
  });

  it("uses singular 'download' when count is 1", () => {
    const summary: DownloadSummary = {
      topStatus: "completed",
      count: 1,
      downloadTypes: ["usenet"],
    };
    render(<DownloadIndicator summary={summary} />);
    const dot = screen.getByRole("status");
    expect(dot.getAttribute("aria-label")).toContain("1 download");
    expect(dot.getAttribute("aria-label")).not.toContain("1 downloads");
  });

  it("animate-pulse is applied only for downloading", () => {
    const downloadingSummary: DownloadSummary = {
      topStatus: "downloading",
      count: 1,
      downloadTypes: ["torrent"],
    };
    const { rerender } = render(<DownloadIndicator summary={downloadingSummary} />);
    expect(screen.getByRole("status").className).toContain("animate-pulse");

    const completedSummary: DownloadSummary = {
      topStatus: "completed",
      count: 1,
      downloadTypes: ["torrent"],
    };
    rerender(<DownloadIndicator summary={completedSummary} />);
    expect(screen.getByRole("status").className).not.toContain("animate-pulse");
  });

  it("overlay variant has absolute class", () => {
    const summary: DownloadSummary = {
      topStatus: "paused",
      count: 1,
      downloadTypes: ["torrent"],
    };
    render(<DownloadIndicator summary={summary} variant="overlay" />);
    expect(screen.getByRole("status").className).toContain("absolute");
  });

  it("inline variant does not have absolute class", () => {
    const summary: DownloadSummary = {
      topStatus: "paused",
      count: 1,
      downloadTypes: ["torrent"],
    };
    render(<DownloadIndicator summary={summary} variant="inline" />);
    expect(screen.getByRole("status").className).not.toContain("absolute");
  });
});
