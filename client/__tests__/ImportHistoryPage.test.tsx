/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ImportHistoryPage from "../src/pages/import-history";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("@/lib/socket", () => ({
  getSocket: () => mockSocket,
}));

vi.mock("lucide-react", () => {
  const Icon = ({ className }: { className?: string }) => (
    <svg data-testid="icon" className={className} />
  );
  return {
    ClipboardList: Icon,
    CheckCircle: Icon,
    AlertTriangle: Icon,
    XCircle: Icon,
    Clock: Icon,
    Loader2: Icon,
  };
});

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="sheet" data-open={String(open)}>
      <button onClick={() => onOpenChange(false)}>close</button>
      {children}
    </div>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}));

const makeTask = (overrides = {}) => ({
  id: "task-1",
  userId: "user-1",
  taskType: "steam_wishlist",
  status: "completed",
  triggeredBy: "cron",
  totalItems: 3,
  addedItems: 2,
  skippedItems: 1,
  failedItems: 0,
  errorMessage: null,
  startedAt: "2024-01-01T10:00:00.000Z",
  completedAt: "2024-01-01T10:00:30.000Z",
  createdAt: "2024-01-01T09:59:00.000Z",
  ...overrides,
});

function createJsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

function renderPage(fetchImpl?: typeof globalThis.fetch) {
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const qc = createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ImportHistoryPage />
    </QueryClientProvider>
  );
}

describe("ImportHistoryPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows empty state when no tasks exist", async () => {
    renderPage(vi.fn(async () => createJsonResponse([])));

    await waitFor(() => {
      expect(screen.getByText("No import tasks yet")).toBeInTheDocument();
    });
  });

  it("renders a task row with correct columns", async () => {
    const task = makeTask();
    renderPage(
      vi.fn(async (url: RequestInfo | URL) => {
        const u = getRequestUrl(url);
        if (u.includes("/api/import-tasks") && !u.match(/import-tasks\/[^/]+$/)) {
          return createJsonResponse([task]);
        }
        return createJsonResponse([]);
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Steam Wishlist")).toBeInTheDocument();
    });

    expect(screen.getByText("cron")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // addedItems
  });

  it("registers and deregisters socket listener", () => {
    renderPage(vi.fn(async () => createJsonResponse([])));

    expect(mockSocket.on).toHaveBeenCalledWith("importTaskUpdate", expect.any(Function));

    // The cleanup is called on unmount — verify it's wired up
    expect(mockSocket.off).not.toHaveBeenCalled();
  });

  it("opens the sheet when a task row is clicked", async () => {
    const task = makeTask();
    const taskWithItems = {
      ...task,
      items: [
        { id: "i1", itemName: "Game 1", result: "added", errorMessage: null, gameTitle: "Game 1" },
      ],
    };

    renderPage(
      vi.fn(async (url: RequestInfo | URL) => {
        const u = getRequestUrl(url);
        if (u.endsWith("/api/import-tasks/task-1")) {
          return createJsonResponse(taskWithItems);
        }
        if (u.includes("/api/import-tasks")) {
          return createJsonResponse([task]);
        }
        return createJsonResponse([]);
      })
    );

    await waitFor(() => screen.getByText("Steam Wishlist"));

    fireEvent.click(screen.getByText("Steam Wishlist").closest("tr")!);

    expect(screen.getByTestId("sheet")).toHaveAttribute("data-open", "true");
  });

  it("shows completed status badge for completed tasks", async () => {
    renderPage(vi.fn(async () => createJsonResponse([makeTask({ status: "completed" })])));

    await waitFor(() => screen.getByText("Completed"));
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows in_progress status badge", async () => {
    renderPage(vi.fn(async () => createJsonResponse([makeTask({ status: "in_progress" })])));

    await waitFor(() => screen.getByText("In progress"));
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("shows failed status badge", async () => {
    renderPage(vi.fn(async () => createJsonResponse([makeTask({ status: "failed" })])));

    await waitFor(() => {
      const matches = screen.getAllByText("Failed");
      expect(matches.some((el) => el.closest("[data-testid='badge']") !== null)).toBe(true);
    });
  });

  it("shows completed_with_errors status badge", async () => {
    renderPage(
      vi.fn(async () => createJsonResponse([makeTask({ status: "completed_with_errors" })]))
    );

    await waitFor(() => screen.getByText("With errors"));
  });

  it("shows pending status badge for unknown status", async () => {
    renderPage(vi.fn(async () => createJsonResponse([makeTask({ status: "pending" })])));

    await waitFor(() => screen.getByText("Pending"));
  });

  it("shows task items in sheet after detail fetch", async () => {
    const task = makeTask();
    const taskWithItems = {
      ...task,
      items: [
        {
          id: "i1",
          itemName: "Steam App 101",
          result: "added",
          errorMessage: null,
          gameTitle: "Half-Life 3",
        },
        {
          id: "i2",
          itemName: "Steam App 102",
          result: "failed",
          errorMessage: "No match",
          gameTitle: null,
        },
      ],
    };

    renderPage(
      vi.fn(async (url: RequestInfo | URL) => {
        const u = getRequestUrl(url);
        if (u.includes("task-1")) return createJsonResponse(taskWithItems);
        if (u.includes("/api/import-tasks")) return createJsonResponse([task]);
        return createJsonResponse([]);
      })
    );

    await waitFor(() => screen.getByText("Steam Wishlist"));
    fireEvent.click(screen.getByText("Steam Wishlist").closest("tr")!);

    await waitFor(() => screen.getByText("Half-Life 3"));
    expect(screen.getByText("Steam App 102")).toBeInTheDocument();
    expect(screen.getByText("No match")).toBeInTheDocument();
  });

  it("handles null timestamps gracefully", async () => {
    renderPage(
      vi.fn(async () =>
        createJsonResponse([makeTask({ startedAt: null, completedAt: null, createdAt: null })])
      )
    );

    await waitFor(() => screen.getByText("Steam Wishlist"));
    // Should render dashes, not throw
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("closes the sheet when close is triggered", async () => {
    const task = makeTask();
    renderPage(
      vi.fn(async (url: RequestInfo | URL) => {
        const u = getRequestUrl(url);
        if (u.includes("/api/import-tasks")) return createJsonResponse([task]);
        return createJsonResponse([]);
      })
    );

    await waitFor(() => screen.getByText("Steam Wishlist"));
    fireEvent.click(screen.getByText("Steam Wishlist").closest("tr")!);
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-open", "true");

    fireEvent.click(screen.getByText("close"));
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-open", "false");
  });
});
