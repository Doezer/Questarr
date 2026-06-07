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
});
