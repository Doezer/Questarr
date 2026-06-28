/** @vitest-environment jsdom */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: mockApiRequest,
}));

import { FileBrowser } from "../src/components/FileBrowser";

function makeResponse(data: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: vi.fn().mockResolvedValue(data) };
}

function makeDirData(overrides: Partial<{ path: string; parent: string; items: unknown[] }> = {}) {
  return {
    path: overrides.path ?? "/data",
    parent: overrides.parent ?? "/",
    items: overrides.items ?? [
      { name: "games", path: "/data/games", isDirectory: true, size: 0 },
      { name: "readme.txt", path: "/data/readme.txt", isDirectory: false, size: 120 },
    ],
  };
}

describe("FileBrowser", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    initialPath: "/data",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when closed", () => {
    render(<FileBrowser {...defaultProps} open={false} />);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("fetches and renders directories and files when open", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    render(<FileBrowser {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("games")).toBeInTheDocument();
      expect(screen.getByText("readme.txt")).toBeInTheDocument();
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("/api/system/browse")
    );
  });

  it("shows empty directory message when items array is empty", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData({ items: [] })));

    render(<FileBrowser {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/empty directory/i)).toBeInTheDocument();
    });
  });

  it("shows error message when fetch fails and path is /", async () => {
    mockApiRequest.mockRejectedValue(new Error("network error"));

    render(<FileBrowser {...defaultProps} initialPath="/" />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load directory/i)).toBeInTheDocument();
    });
  });

  it("resets to / when non-root path fails (fallback path reset)", async () => {
    // First call fails (for /data), triggers path reset to /
    // Second call for / succeeds
    mockApiRequest
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(makeResponse(makeDirData({ path: "/", parent: "" })));

    render(<FileBrowser {...defaultProps} initialPath="/data" />);

    await waitFor(() => {
      // After reset to /, it shows the current path
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it("navigates into a subdirectory when directory is clicked", async () => {
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(makeDirData()))
      .mockResolvedValueOnce(
        makeResponse(makeDirData({ path: "/data/games", parent: "/data", items: [] }))
      );

    render(<FileBrowser {...defaultProps} />);

    const dirButton = await screen.findByRole("button", { name: "games" });
    fireEvent.click(dirButton);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
      expect(mockApiRequest).toHaveBeenLastCalledWith(
        "GET",
        expect.stringContaining(encodeURIComponent("/data/games"))
      );
    });
  });

  it("navigates up when up button is clicked", async () => {
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(makeDirData({ path: "/data", parent: "/" })))
      .mockResolvedValueOnce(makeResponse(makeDirData({ path: "/", parent: "", items: [] })));

    render(<FileBrowser {...defaultProps} />);

    await screen.findByRole("button", { name: "games" });

    const upButton = screen.getByRole("button", { name: /navigate up/i });
    fireEvent.click(upButton);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
      expect(mockApiRequest).toHaveBeenLastCalledWith(
        "GET",
        expect.stringContaining(encodeURIComponent("/"))
      );
    });
  });

  it("calls onSelect with currentPath and closes when Select Current is clicked", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    render(<FileBrowser {...defaultProps} onSelect={onSelect} onOpenChange={onOpenChange} />);

    await screen.findByRole("button", { name: "games" });

    fireEvent.click(screen.getByRole("button", { name: /select current/i }));

    expect(onSelect).toHaveBeenCalledWith("/data");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    render(<FileBrowser {...defaultProps} onOpenChange={onOpenChange} />);

    await screen.findByRole("button", { name: "games" });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses root param in URL when root prop is provided", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    render(<FileBrowser {...defaultProps} root="/" />);

    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());

    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      expect.stringContaining("root=" + encodeURIComponent("/"))
    );
  });

  it("falls back to no-root URL when root fetch fails", async () => {
    const fallbackData = makeDirData({ path: "/data", parent: "/", items: [] });

    // First call (with root) fails, fallback call (without root) succeeds
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(null, false)) // !res.ok triggers throw
      .mockResolvedValueOnce(makeResponse(fallbackData));

    render(<FileBrowser {...defaultProps} root="/custom-root" />);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
      // Second call should NOT include root param
      const secondCall = mockApiRequest.mock.calls[1][1] as string;
      expect(secondCall).not.toContain("root=");
    });
  });

  it("shows error when both primary and fallback requests fail at /", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(null, false));

    render(<FileBrowser {...defaultProps} initialPath="/" root="/custom-root" />);

    await waitFor(() => {
      expect(screen.getByText(/failed to load directory/i)).toBeInTheDocument();
    });
  });

  it("resets currentPath to initialPath when dialog reopens", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    const { rerender } = render(
      <FileBrowser {...defaultProps} open={false} initialPath="/initial" />
    );

    rerender(<FileBrowser {...defaultProps} open={true} initialPath="/initial" />);

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "GET",
        expect.stringContaining(encodeURIComponent("/initial"))
      );
    });
  });

  it("navigates via keyboard Enter on directory button", async () => {
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(makeDirData()))
      .mockResolvedValueOnce(
        makeResponse(makeDirData({ path: "/data/games", parent: "/data", items: [] }))
      );

    render(<FileBrowser {...defaultProps} />);

    const dirButton = await screen.findByRole("button", { name: "games" });
    fireEvent.keyDown(dirButton, { key: "Enter" });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it("navigates via keyboard Space on directory button", async () => {
    mockApiRequest
      .mockResolvedValueOnce(makeResponse(makeDirData()))
      .mockResolvedValueOnce(
        makeResponse(makeDirData({ path: "/data/games", parent: "/data", items: [] }))
      );

    render(<FileBrowser {...defaultProps} />);

    const dirButton = await screen.findByRole("button", { name: "games" });
    fireEvent.keyDown(dirButton, { key: " " });

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it("uses custom title when provided", async () => {
    mockApiRequest.mockResolvedValue(makeResponse(makeDirData()));

    render(<FileBrowser {...defaultProps} title="Pick a Folder" />);

    expect(screen.getByText("Pick a Folder")).toBeInTheDocument();
  });

  it("up button is disabled when there is no parent", async () => {
    mockApiRequest.mockResolvedValue(
      makeResponse(makeDirData({ path: "/", parent: "", items: [] }))
    );

    render(<FileBrowser {...defaultProps} initialPath="/" />);

    await waitFor(() => expect(screen.getByText(/empty directory/i)).toBeInTheDocument());

    const upButton = screen.getByRole("button", { name: /navigate up/i });
    expect(upButton).toBeDisabled();
  });
});
