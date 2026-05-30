/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Downloads from "../src/pages/downloads";

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock("../src/components/DownloadDetailsModal", () => ({
  default: ({
    open,
    downloadId,
    downloadName,
  }: {
    open: boolean;
    downloadId: string;
    downloadName: string;
  }) =>
    open ? (
      <div data-testid="download-details-modal">
        {downloadId}:{downloadName}
      </div>
    ) : null,
}));

vi.mock("@/components/ClaimDownloadModal", () => ({
  default: ({ open, download }: { open: boolean; download: { id: string; name: string } }) =>
    open ? (
      <div data-testid="claim-download-modal">
        {download.id}:{download.name}
      </div>
    ) : null,
}));

vi.mock("@/components/ClaimBatchModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="claim-batch-modal">Claim batch modal</div> : null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const response = await fetch(queryKey.join(""));
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        },
      },
      mutations: {
        retry: false,
      },
    },
  });

describe("Downloads page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toastSpy.mockReset();
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/downloads")) {
        return {
          ok: true,
          json: async () => ({ downloads: [], errors: [] }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  const renderPage = () =>
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Downloads />
      </QueryClientProvider>
    );

  it("keeps the scan unlinked action available and opens the batch modal", async () => {
    renderPage();

    const scanButton = await screen.findByRole("button", { name: "Scan unlinked downloads" });
    expect(scanButton).toHaveTextContent("Scan");

    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByTestId("claim-batch-modal")).toBeInTheDocument();
    });
  });

  it("filters downloads by search and Questarr-only toggle while showing the category banner", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/downloads")) {
        return {
          ok: true,
          json: async () => ({
            downloads: [
              {
                id: "dl-1",
                name: "Questarr Release",
                status: "downloading",
                progress: 55,
                downloaderId: "downloader-1",
                downloaderName: "qBittorrent",
                trackedByQuestarr: true,
                downloaderCategory: "questarr",
                downloadType: "torrent",
                size: 1024,
                downloaded: 512,
              },
              {
                id: "dl-2",
                name: "Manual NZB",
                status: "completed",
                progress: 100,
                downloaderId: "downloader-2",
                downloaderName: "SABnzbd",
                trackedByQuestarr: false,
                downloadType: "usenet",
              },
            ],
            errors: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    expect(await screen.findByTestId("category-filter-banner")).toHaveTextContent(
      'qBittorrent: "questarr"'
    );
    expect(screen.getByTestId("card-download-dl-1")).toBeInTheDocument();
    expect(screen.getByTestId("card-download-dl-2")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Filter downloads" }), {
      target: { value: "manual" },
    });

    await waitFor(() => {
      expect(screen.queryByTestId("card-download-dl-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("card-download-dl-2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByTestId("filter-source-questarr"));

    await waitFor(() => {
      expect(screen.getByTestId("card-download-dl-1")).toBeInTheDocument();
      expect(screen.queryByTestId("card-download-dl-2")).not.toBeInTheDocument();
    });
  });

  it("shows a filtered empty state message when no downloads match the active search", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/downloads")) {
        return {
          ok: true,
          json: async () => ({
            downloads: [
              {
                id: "dl-3",
                name: "Only Torrent",
                status: "downloading",
                progress: 25,
                downloaderId: "downloader-1",
                downloaderName: "qBittorrent",
                trackedByQuestarr: true,
                downloadType: "torrent",
              },
            ],
            errors: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    await screen.findByTestId("card-download-dl-3");
    fireEvent.change(screen.getByRole("textbox", { name: "Filter downloads" }), {
      target: { value: "missing" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("text-no-downloads-title")).toHaveTextContent(
        "No Active Downloads"
      );
      expect(screen.getByTestId("text-no-downloads-description")).toHaveTextContent(
        "No downloads match the current filters"
      );
    });
  });

  it("shows the loading skeleton before downloads resolve", async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    ) as never;

    renderPage();

    expect(await screen.findByTestId("loading-downloads")).toBeInTheDocument();

    resolveResponse?.({
      ok: true,
      json: async () => ({ downloads: [], errors: [] }),
    } as Response);

    expect(await screen.findByTestId("card-no-downloads")).toBeInTheDocument();
  });

  it("renders torrent and usenet-specific metric badges and download errors", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/downloads")) {
        return {
          ok: true,
          json: async () => ({
            downloads: [
              {
                id: "dl-torrent",
                name: "Torrent Game",
                status: "downloading",
                progress: 45,
                downloaderId: "downloader-1",
                downloaderName: "qBittorrent",
                trackedByQuestarr: true,
                downloadType: "torrent",
                size: 2 * 1024 * 1024,
                downloaded: 1024 * 1024,
                downloadSpeed: 2048,
                uploadSpeed: 512,
                eta: 3600,
                seeders: 12,
                leechers: 3,
                ratio: 1.25,
              },
              {
                id: "dl-usenet",
                name: "Usenet Game",
                status: "error",
                progress: 90,
                downloaderId: "downloader-2",
                downloaderName: "SABnzbd",
                trackedByQuestarr: false,
                downloadType: "usenet",
                repairStatus: "repairing",
                unpackStatus: "running",
                age: 5,
                grabs: 8,
                error: "Post-processing failed",
              },
            ],
            errors: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    renderPage();

    expect(await screen.findByTestId("badge-download-speed-dl-torrent")).toBeInTheDocument();
    expect(screen.getByTestId("badge-upload-speed-dl-torrent")).toBeInTheDocument();
    expect(screen.getByTestId("badge-eta-dl-torrent")).toBeInTheDocument();
    expect(screen.getByTestId("badge-peers-dl-torrent")).toBeInTheDocument();
    expect(screen.getByTestId("badge-ratio-dl-torrent")).toBeInTheDocument();

    expect(screen.getByTestId("badge-repair-dl-usenet")).toBeInTheDocument();
    expect(screen.getByTestId("badge-unpack-dl-usenet")).toBeInTheDocument();
    expect(screen.getByTestId("badge-age-dl-usenet")).toBeInTheDocument();
    expect(screen.getByTestId("badge-grabs-dl-usenet")).toBeInTheDocument();
    expect(screen.getByTestId("text-error-dl-usenet")).toHaveTextContent("Post-processing failed");
  });

  it("opens details and claim modals, performs download actions, and reports downloader errors", async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);

      if (target === "/api/downloads") {
        return {
          ok: true,
          json: async () => ({
            downloads: [
              {
                id: "dl-active",
                name: "Active Download",
                status: "downloading",
                progress: 40,
                downloaderId: "downloader-1",
                downloaderName: "qBittorrent",
                trackedByQuestarr: true,
                downloadType: "torrent",
              },
              {
                id: "dl-paused",
                name: "Paused Download",
                status: "paused",
                progress: 60,
                downloaderId: "downloader-1",
                downloaderName: "qBittorrent",
                trackedByQuestarr: true,
                downloadType: "torrent",
              },
            ],
            errors: [
              {
                downloaderId: "downloader-err",
                downloaderName: "Broken Client",
                error: "Indexer auth failed",
              },
            ],
          }),
        } as Response;
      }

      if (target.includes("/pause") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }

      if (target.includes("/resume") && init?.method === "POST") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }

      if (target.includes("/api/downloaders/") && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as never;

    renderPage();

    expect(await screen.findByTestId("button-pause-dl-active")).toBeInTheDocument();
    expect(screen.getByTestId("button-resume-dl-paused")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-pause-dl-active"));
    fireEvent.click(screen.getByTestId("button-resume-dl-paused"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/downloaders/downloader-1/downloads/dl-active/pause",
        expect.objectContaining({ method: "POST" })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/downloaders/downloader-1/downloads/dl-paused/resume",
        expect.objectContaining({ method: "POST" })
      );
    });

    fireEvent.click(screen.getByTestId("button-menu-dl-active"));
    fireEvent.click(await screen.findByTestId("button-details-dl-active"));
    expect(await screen.findByTestId("download-details-modal")).toHaveTextContent(
      "dl-active:Active Download"
    );

    fireEvent.click(screen.getByTestId("button-menu-dl-active"));
    fireEvent.click(await screen.findByTestId("button-link-dl-active"));
    expect(await screen.findByTestId("claim-download-modal")).toHaveTextContent(
      "dl-active:Active Download"
    );

    fireEvent.click(screen.getByTestId("button-menu-dl-active"));
    fireEvent.click(await screen.findByTestId("button-remove-dl-active"));
    fireEvent.click(screen.getByTestId("button-menu-dl-active"));
    fireEvent.click(await screen.findByTestId("button-remove-files-dl-active"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/downloaders/downloader-1/downloads/dl-active?deleteFiles=false",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/downloaders/downloader-1/downloads/dl-active?deleteFiles=true",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Downloader Error: Broken Client",
        description: "Indexer auth failed",
        variant: "destructive",
      })
    );
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Download paused" }));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Download resumed" }));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Download removed" }));
  });
});
