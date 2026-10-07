/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { RootFolderDiscovery } from "../src/components/RootFolderDiscovery";
import type { RootFolder } from "@shared/schema";

const mockSocket = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }));
vi.mock("@/lib/socket", () => ({
  getSocket: () => mockSocket,
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    apiRequest: vi.fn(async () => ({ json: async () => ({}) })),
  };
});

function createJsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Response;
}

function mockFetch(folders: RootFolder[], scanStatus: unknown[] = [], unmatched: unknown[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/library/scan/status")) return createJsonResponse(scanStatus);
    if (u.includes("/api/library/scan/unmatched")) return createJsonResponse(unmatched);
    if (u.includes("/api/root-folders")) return createJsonResponse(folders);
    return createJsonResponse({});
  });
}

function renderComponent() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RootFolderDiscovery />
    </QueryClientProvider>
  );
}

const folder: RootFolder = {
  id: "rf-1",
  path: "/mnt/old-library",
  name: "Old NAS",
  enabled: true,
  allowDelete: false,
  accessible: true,
  diskFreeBytes: 1024 * 1024 * 1024,
  diskTotalBytes: 2 * 1024 * 1024 * 1024,
  lastScannedAt: null,
  createdAt: new Date(),
};

describe("RootFolderDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes the library and Needs Review list once scan progress is known", async () => {
    mockFetch(
      [folder],
      [
        {
          rootFolderId: "rf-1",
          rootFolderPath: "/mnt/old-library",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "completed",
          totalCandidates: 3,
          processedCandidates: 3,
          matched: 2,
          unmatched: 1,
          errors: 0,
        },
      ]
    );
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <RootFolderDiscovery />
      </QueryClientProvider>
    );

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/games"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/library/scan/unmatched"] });
  });

  it("keeps polling scan status after a scan started by saving import settings", async () => {
    // The first status fetch lands before the server registers the scan.
    let statusCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const u = getRequestUrl(url);
      if (u.includes("/api/library/scan/status")) {
        statusCalls += 1;
        return createJsonResponse(
          statusCalls === 1
            ? []
            : [
                {
                  rootFolderId: "rf-1",
                  rootFolderPath: "/mnt/old-library",
                  startedAt: new Date().toISOString(),
                  status: "running",
                  totalCandidates: 3,
                  processedCandidates: 1,
                  matched: 1,
                  unmatched: 0,
                  errors: 0,
                },
              ]
        );
      }
      if (u.includes("/api/root-folders")) return createJsonResponse([folder]);
      return createJsonResponse([]);
    });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <RootFolderDiscovery scanKickoffAt={Date.now()} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(statusCalls).toBeGreaterThan(1), { timeout: 4000 });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/games"] }));
  });

  it("shows scan progress pushed by the server without waiting for a poll", async () => {
    mockFetch([folder]);
    renderComponent();
    await screen.findByText("/mnt/old-library");

    const handler = mockSocket.on.mock.calls.find(
      ([event]) => event === "library-scan-progress"
    )?.[1];
    expect(handler).toBeDefined();
    act(() => {
      handler({
        rootFolderId: "rf-1",
        rootFolderPath: "/mnt/scan-pushed",
        startedAt: new Date().toISOString(),
        status: "running",
        totalCandidates: 4,
        processedCandidates: 1,
        matched: 1,
        unmatched: 0,
        errors: 0,
      });
    });

    expect(await screen.findByText("/mnt/scan-pushed")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("lets the user search IGDB under their own name when no candidate fits", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    mockFetch(
      [folder],
      [],
      [
        {
          rootFolderId: "rf-1",
          rootFolderPath: "/mnt/old-library",
          folderName: "Absolum v1.01 [CUSA53342] [EUR]",
          absolutePath: "/mnt/old-library/Absolum v1.01 [CUSA53342] [EUR]",
          candidates: [{ igdbId: 314, name: "Wrong Game", releaseYear: 2001 }],
        },
      ]
    );
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => [{ igdbId: 777, name: "Absolum", releaseYear: 2025 }],
    } as Response);
    renderComponent();

    const input = await screen.findByLabelText("Search IGDB for Absolum v1.01 [CUSA53342] [EUR]");
    fireEvent.change(input, { target: { value: "Absolum" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/scan/unmatched/search", {
        rootFolderId: "rf-1",
        folderName: "Absolum v1.01 [CUSA53342] [EUR]",
        query: "Absolum",
      })
    );
    // The searched result replaces the scan's guess and can be picked.
    fireEvent.click(await screen.findByRole("button", { name: "Absolum (2025)" }));
    expect(screen.queryByRole("button", { name: "Wrong Game (2001)" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/scan/unmatched/match", {
        rootFolderId: "rf-1",
        folderName: "Absolum v1.01 [CUSA53342] [EUR]",
        igdbId: 777,
      })
    );
  });

  it("shows an empty state when there are no root folders", async () => {
    renderComponent();
    expect(await screen.findByText("No root folders configured yet")).toBeInTheDocument();
  });

  it("renders an existing folder with its health and free space", async () => {
    mockFetch([folder]);
    renderComponent();

    expect(await screen.findByText("/mnt/old-library")).toBeInTheDocument();
    expect(screen.getByText("Old NAS")).toBeInTheDocument();
    expect(screen.getByText("Accessible")).toBeInTheDocument();
  });

  it("flags an inaccessible folder", async () => {
    mockFetch([{ ...folder, accessible: false }]);
    renderComponent();

    expect(await screen.findByText("Inaccessible")).toBeInTheDocument();
  });

  it("disables adding a folder until a path is entered", async () => {
    renderComponent();
    await screen.findByText("No root folders configured yet");

    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    expect(screen.getByRole("button", { name: "Add Root Folder" })).toBeDisabled();
  });

  it("submits a new root folder and shows a success toast", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();
    await screen.findByText("No root folders configured yet");

    fireEvent.click(screen.getByRole("button", { name: /add folder/i }));
    fireEvent.change(screen.getByLabelText("Path"), {
      target: { value: "/mnt/old-library" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Root Folder" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/root-folders",
        expect.objectContaining({ path: "/mnt/old-library" })
      );
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Root Folder Added" })
      );
    });
  });

  it("deletes a folder when the delete button is clicked", async () => {
    mockFetch([folder]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    const deleteButton = await screen.findByLabelText("Delete /mnt/old-library");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/root-folders/rf-1");
    });
  });

  it("toggles a folder's enabled state", async () => {
    mockFetch([folder]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    const toggle = await screen.findByLabelText("Enable /mnt/old-library");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/root-folders/rf-1", {
        enabled: false,
      });
    });
  });

  it("toggles a folder's allow-delete state and warns when turning it on", async () => {
    mockFetch([folder]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    const toggle = await screen.findByLabelText("Allow deleting files in /mnt/old-library");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/root-folders/rf-1", {
        allowDelete: true,
      });
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Deletion Allowed" })
      );
    });
  });

  it("triggers a scan of all folders", async () => {
    mockFetch([folder]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();
    await screen.findByText("/mnt/old-library");

    fireEvent.click(screen.getByRole("button", { name: /scan all/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/scan", {});
    });
  });

  it("shows unmatched entries and resolves one against an IGDB candidate", async () => {
    mockFetch(
      [folder],
      [],
      [
        {
          rootFolderId: "rf-1",
          rootFolderPath: "/mnt/old-library",
          folderName: "Mystery Game",
          absolutePath: "/mnt/old-library/Mystery Game",
          candidates: [{ igdbId: 42, name: "Some Game", releaseYear: 2020 }],
        },
      ]
    );
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    expect(await screen.findByText("Needs Review (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Some Game \(2020\)/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/library/scan/unmatched/match", {
        rootFolderId: "rf-1",
        folderName: "Mystery Game",
        igdbId: 42,
      });
    });
  });
});
