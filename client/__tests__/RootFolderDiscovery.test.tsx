/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { RootFolderDiscovery } from "../src/components/RootFolderDiscovery";
import type { RootFolder } from "@shared/schema";

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
