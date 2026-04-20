/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock @tanstack/react-query before importing the hook
const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
}));

// Capture toast calls
const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: mockToast,
}));

// Import after mocks are set up
const { useBackgroundNotifications } = await import("../src/hooks/use-background-notifications");

interface DownloadStatus {
  id: string;
  name: string;
  status: "downloading" | "seeding" | "completed" | "paused" | "error";
  progress: number;
  error?: string;
  downloaderId: string;
  downloaderName: string;
}

function makeDownload(
  id: string,
  status: DownloadStatus["status"],
  extras: Partial<DownloadStatus> = {}
): DownloadStatus {
  return {
    id,
    name: `Download ${id}`,
    status,
    progress: 50,
    downloaderId: "dl-1",
    downloaderName: "Client",
    ...extras,
  };
}

describe("useBackgroundNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: undefined });
  });

  it("returns null", () => {
    const { result } = renderHook(() => useBackgroundNotifications());
    expect(result.current).toBeNull();
  });

  it("does not toast when there are no downloads", () => {
    mockUseQuery.mockReturnValue({ data: { downloads: [], errors: [] } });
    renderHook(() => useBackgroundNotifications());
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not toast when a new download first appears (no previous state)", () => {
    mockUseQuery.mockReturnValue({
      data: { downloads: [makeDownload("dl-1", "downloading")], errors: [] },
    });
    renderHook(() => useBackgroundNotifications());
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("toasts on completion when status transitions from downloading to completed", () => {
    const downloading = makeDownload("dl-1", "downloading");
    const completed = makeDownload("dl-1", "completed");

    // First render: track download as "downloading"
    mockUseQuery.mockReturnValue({ data: { downloads: [downloading], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    // Second render: download becomes "completed"
    mockUseQuery.mockReturnValue({ data: { downloads: [completed], errors: [] } });
    rerender();

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Download completed", description: "Download dl-1" })
    );
  });

  it("toasts on error when status transitions to error", () => {
    const downloading = makeDownload("dl-1", "downloading");
    const errored = makeDownload("dl-1", "error", { error: "Connection refused" });

    mockUseQuery.mockReturnValue({ data: { downloads: [downloading], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    mockUseQuery.mockReturnValue({ data: { downloads: [errored], errors: [] } });
    rerender();

    expect(mockToast).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Download error",
        description: "Connection refused",
        variant: "destructive",
      })
    );
  });

  it("uses download name as error description when no error message provided", () => {
    const downloading = makeDownload("dl-1", "downloading");
    const errored = makeDownload("dl-1", "error"); // no error field

    mockUseQuery.mockReturnValue({ data: { downloads: [downloading], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    mockUseQuery.mockReturnValue({ data: { downloads: [errored], errors: [] } });
    rerender();

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Download dl-1" })
    );
  });

  it("does not toast for already-completed downloads (no status change)", () => {
    const completed = makeDownload("dl-1", "completed");

    // Both renders have the same completed status
    mockUseQuery.mockReturnValue({ data: { downloads: [completed], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    mockUseQuery.mockReturnValue({ data: { downloads: [completed], errors: [] } });
    rerender();

    // Toast fires 0 times (new download first appear, no prior → no toast)
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("does not toast when status stays at downloading", () => {
    const dl = makeDownload("dl-1", "downloading", { progress: 30 });
    const dlProgressed = makeDownload("dl-1", "downloading", { progress: 60 });

    mockUseQuery.mockReturnValue({ data: { downloads: [dl], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    mockUseQuery.mockReturnValue({ data: { downloads: [dlProgressed], errors: [] } });
    rerender();

    expect(mockToast).not.toHaveBeenCalled();
  });

  it("handles multiple downloads completing independently", () => {
    const dl1 = makeDownload("dl-1", "downloading");
    const dl2 = makeDownload("dl-2", "downloading");

    mockUseQuery.mockReturnValue({ data: { downloads: [dl1, dl2], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    mockUseQuery.mockReturnValue({
      data: {
        downloads: [makeDownload("dl-1", "completed"), makeDownload("dl-2", "completed")],
        errors: [],
      },
    });
    rerender();

    expect(mockToast).toHaveBeenCalledTimes(2);
  });

  it("cleans up tracking when a download disappears from a non-empty list", () => {
    const dl1 = makeDownload("dl-1", "downloading");
    const dl2 = makeDownload("dl-2", "downloading");

    // Both tracked
    mockUseQuery.mockReturnValue({ data: { downloads: [dl1, dl2], errors: [] } });
    const { rerender } = renderHook(() => useBackgroundNotifications());

    // dl-1 disappears from a non-empty list — cleanup fires for dl-1
    mockUseQuery.mockReturnValue({
      data: { downloads: [makeDownload("dl-2", "downloading")], errors: [] },
    });
    rerender();

    // dl-1 re-appears as completed — treated as new (no previous record), no toast
    mockUseQuery.mockReturnValue({
      data: {
        downloads: [makeDownload("dl-1", "completed"), makeDownload("dl-2", "downloading")],
        errors: [],
      },
    });
    rerender();

    expect(mockToast).not.toHaveBeenCalled();
  });
});
