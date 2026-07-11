/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import DownloadDetailsModal from "../src/components/DownloadDetailsModal";
import type { DownloadDetails } from "@shared/schema";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  TabsContent: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

const baseDetails: DownloadDetails = {
  id: "hash-1",
  name: "Example Download",
  status: "downloading",
  progress: 50,
  files: [],
  trackers: [],
};

function renderModal(details: DownloadDetails) {
  mockUseQuery.mockReturnValue({
    data: details,
    isLoading: false,
    error: null,
  });

  render(
    <DownloadDetailsModal
      downloaderId="downloader-1"
      downloadId="hash-1"
      downloadName="Example Download"
      open={true}
      onOpenChange={() => {}}
    />
  );
}

describe("DownloadDetailsModal files tab", () => {
  it("shows an unsupported message when downloader does not expose file listing", async () => {
    renderModal({
      ...baseDetails,
      filesSupport: "unsupported",
      filesSupportReason: "This downloader does not expose per-file listing.",
    });

    expect(await screen.findByTestId("files-unsupported")).toHaveTextContent(
      "This downloader does not expose per-file listing."
    );
    expect(screen.getByTestId("tab-files")).toHaveTextContent("Files (N/A)");
  });

  it("shows an empty-state message when file listing is supported but currently empty", async () => {
    renderModal({
      ...baseDetails,
      filesSupport: "supported",
      files: [],
    });

    expect(await screen.findByTestId("no-files")).toHaveTextContent(
      "No files reported yet for this download"
    );
  });

  it("renders file rows with priority badges and skipped indicator", async () => {
    renderModal({
      ...baseDetails,
      filesSupport: "supported",
      files: [
        { name: "game.iso", size: 1024, progress: 100, priority: "high", wanted: true },
        { name: "readme.txt", size: 128, progress: 0, priority: "off", wanted: false },
      ],
    });

    expect(await screen.findByTestId("file-0")).toHaveTextContent("game.iso");
    expect(screen.getByTestId("file-1")).toHaveTextContent("readme.txt");
    expect(screen.getByTestId("file-1")).toHaveTextContent("Skipped");
    expect(screen.getByTestId("tab-files")).toHaveTextContent("Files (2)");
  });

  it("treats missing filesSupport as supported for backward compatibility", async () => {
    renderModal({
      ...baseDetails,
      files: [{ name: "a.bin", size: 10, progress: 10, priority: "normal", wanted: true }],
    });

    expect(await screen.findByTestId("file-0")).toBeInTheDocument();
    expect(screen.getByTestId("tab-files")).toHaveTextContent("Files (1)");
  });
});

describe("DownloadDetailsModal info tab", () => {
  it("renders hash, download dir, size, dates, peers, creator and comment", async () => {
    renderModal({
      ...baseDetails,
      hash: "abc123",
      downloadDir: "/downloads/game",
      size: 2048,
      downloaded: 1024,
      addedDate: "2024-01-01T00:00:00.000Z",
      completedDate: "2024-01-02T00:00:00.000Z",
      connectedPeers: 5,
      creator: "Some Group",
      comment: "A comment",
    });

    expect(await screen.findByTestId("detail-hash")).toHaveTextContent("abc123");
    expect(screen.getByTestId("detail-download-dir")).toHaveTextContent("/downloads/game");
    expect(screen.getByTestId("detail-size")).toBeInTheDocument();
    expect(screen.getByTestId("detail-added-date")).toBeInTheDocument();
    expect(screen.getByTestId("detail-completed-date")).toBeInTheDocument();
    expect(screen.getByTestId("detail-peers")).toHaveTextContent("5");
    expect(screen.getByTestId("detail-creator")).toHaveTextContent("Some Group");
    expect(screen.getByTestId("detail-comment")).toHaveTextContent("A comment");
    expect(screen.getByTestId("detail-progress")).toHaveTextContent("50.0%");
  });

  it("omits optional info fields when not provided", async () => {
    renderModal(baseDetails);
    expect(await screen.findByTestId("detail-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-hash")).not.toBeInTheDocument();
    expect(screen.queryByTestId("detail-creator")).not.toBeInTheDocument();
  });
});

describe("DownloadDetailsModal trackers tab", () => {
  it("shows a no-trackers message when there are none", async () => {
    renderModal(baseDetails);
    expect(await screen.findByTestId("no-trackers")).toHaveTextContent(
      "No tracker information available"
    );
    expect(screen.getByTestId("tab-trackers")).toHaveTextContent("Trackers (0)");
  });

  it("renders tracker rows with status, seeders, leechers, and errors", async () => {
    renderModal({
      ...baseDetails,
      trackers: [
        {
          url: "udp://tracker.example.com:80",
          status: "working",
          tier: 0,
          seeders: 10,
          leechers: 2,
          lastAnnounce: "2024-01-01T00:00:00.000Z",
          nextAnnounce: "2024-01-01T01:00:00.000Z",
        },
        {
          url: "udp://tracker2.example.com:80",
          status: "error",
          tier: 1,
          error: "Connection refused",
        },
        {
          url: "udp://tracker3.example.com:80",
          status: "updating",
          tier: 1,
        },
        {
          url: "udp://tracker4.example.com:80",
          status: "inactive",
          tier: 1,
        },
      ],
    });

    expect(await screen.findByTestId("tracker-0")).toHaveTextContent(
      "udp://tracker.example.com:80"
    );
    expect(screen.getByTestId("tracker-0")).toHaveTextContent("Seeds: 10");
    expect(screen.getByTestId("tracker-0")).toHaveTextContent("Leechers: 2");
    expect(screen.getByTestId("tracker-1")).toHaveTextContent("Connection refused");
    expect(screen.getByTestId("tab-trackers")).toHaveTextContent("Trackers (4)");
  });
});

describe("DownloadDetailsModal loading and error states", () => {
  it("shows a loading indicator while fetching", () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(
      <DownloadDetailsModal
        downloaderId="downloader-1"
        downloadId="hash-1"
        downloadName="Example Download"
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByTestId("download-details-loading")).toBeInTheDocument();
  });

  it("shows an error message when the query fails", () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network failure"),
    });
    render(
      <DownloadDetailsModal
        downloaderId="downloader-1"
        downloadId="hash-1"
        downloadName="Example Download"
        open={true}
        onOpenChange={() => {}}
      />
    );
    expect(screen.getByTestId("download-details-error")).toHaveTextContent("Network failure");
  });

  it("renders the dialog title with the download name", async () => {
    renderModal(baseDetails);
    expect(await screen.findByTestId("download-details-title")).toHaveTextContent(
      "Example Download"
    );
  });
});

describe("DownloadDetailsModal mobile layout", () => {
  it("renders inside a drawer when on mobile", async () => {
    vi.doMock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
    vi.resetModules();
    const { default: MobileModal } = await import("../src/components/DownloadDetailsModal");
    mockUseQuery.mockReturnValue({ data: baseDetails, isLoading: false, error: null });

    render(
      <MobileModal
        downloaderId="downloader-1"
        downloadId="hash-1"
        downloadName="Example Download"
        open={true}
        onOpenChange={() => {}}
      />
    );

    expect(await screen.findByTestId("download-details-title")).toHaveTextContent(
      "Example Download"
    );
    vi.doUnmock("@/hooks/use-mobile");
  });
});
