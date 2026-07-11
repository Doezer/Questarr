/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { PathMappingSettings } from "../src/components/PathMappingSettings";
import type { Downloader, PathMapping } from "@shared/schema";

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

const downloaders: Downloader[] = [
  {
    id: "d1",
    name: "qBittorrent",
    type: "qbittorrent",
    url: "http://qbit.local:8080",
    enabled: true,
  } as unknown as Downloader,
];

function mockFetch(mappings: PathMapping[], downloadersData: Downloader[] = downloaders) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const u = getRequestUrl(url);
    if (u.includes("/api/imports/mappings/paths")) return createJsonResponse(mappings);
    if (u.includes("/api/downloaders")) return createJsonResponse(downloadersData);
    return createJsonResponse({});
  });
}

function renderComponent() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PathMappingSettings />
    </QueryClientProvider>
  );
}

describe("PathMappingSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an empty state when there are no mappings", async () => {
    renderComponent();
    expect(await screen.findByText("No mappings defined")).toBeInTheDocument();
  });

  it("renders existing mappings scoped to a downloader and generic ones", async () => {
    mockFetch([
      {
        id: "m1",
        remotePath: "/downloads",
        localPath: "/mnt/downloads",
        remoteHost: "qbit.local",
      } as PathMapping,
      {
        id: "m2",
        remotePath: "/data",
        localPath: "/mnt/data",
        remoteHost: null,
      } as PathMapping,
      {
        id: "m3",
        remotePath: "/other",
        localPath: "/mnt/other",
        remoteHost: "unknown.local",
      } as PathMapping,
    ]);

    renderComponent();

    expect(await screen.findByText("/mnt/downloads")).toBeInTheDocument();
    expect(screen.getByText("qBittorrent")).toBeInTheDocument();
    expect(screen.getByText("Any downloader")).toBeInTheDocument();
    expect(screen.getByText("No matching downloader")).toBeInTheDocument();
  });

  it("validates required fields before submitting a new mapping", async () => {
    renderComponent();
    await screen.findByText("No mappings defined");

    fireEvent.click(screen.getByRole("button", { name: /add mapping/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create Mapping" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Validation Error" })
      );
    });
  });

  it("submits a new mapping and shows success toast", async () => {
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();
    await screen.findByText("No mappings defined");

    fireEvent.click(screen.getByRole("button", { name: /add mapping/i }));
    fireEvent.change(screen.getByPlaceholderText("/home/user/downloads"), {
      target: { value: "/downloads" },
    });
    fireEvent.change(screen.getByPlaceholderText("/mnt/media/downloads"), {
      target: { value: "/mnt/downloads" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Mapping" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/imports/mappings/paths",
        expect.objectContaining({ remotePath: "/downloads", localPath: "/mnt/downloads" })
      );
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Mapping Added" }));
    });
  });

  it("opens the edit dialog pre-filled and submits an update", async () => {
    mockFetch([
      { id: "m1", remotePath: "/downloads", localPath: "/mnt/downloads", remoteHost: null },
    ]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    const editButton = await screen.findByLabelText("Edit mapping for /downloads");
    fireEvent.click(editButton);

    expect(screen.getByDisplayValue("/downloads")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PATCH",
        "/api/imports/mappings/paths/m1",
        expect.objectContaining({ remotePath: "/downloads" })
      );
    });
  });

  it("deletes a mapping when the delete button is clicked", async () => {
    mockFetch([
      { id: "m1", remotePath: "/downloads", localPath: "/mnt/downloads", remoteHost: null },
    ]);
    const { apiRequest } = await import("@/lib/queryClient");
    renderComponent();

    const deleteButton = await screen.findByLabelText("Delete mapping for /downloads");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/imports/mappings/paths/m1");
    });
  });
});
