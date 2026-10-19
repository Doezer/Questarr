/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient, getRequestUrl } from "./test-utils";
import { RommSettings } from "../src/components/RommSettings";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest };
});

const saved = {
  enabled: true,
  url: "http://romm.lan:8080",
  apiToken: "********",
  platformFolders: false,
  syncEnabled: false,
  scanAfterImport: true,
  lastSync: null,
};

function renderComponent() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RommSettings />
    </QueryClientProvider>
  );
}

describe("RommSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const body = getRequestUrl(url).includes("/api/settings/romm") ? saved : {};
      return { ok: true, json: async () => body } as Response;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads the saved settings and warns about plaintext http", async () => {
    renderComponent();
    expect(await screen.findByDisplayValue("http://romm.lan:8080")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/unencrypted/);
  });

  it("saves the platform folder switch without the sync timestamp", async () => {
    renderComponent();
    await screen.findByDisplayValue("http://romm.lan:8080");
    fireEvent.click(screen.getByLabelText("RomM platform folders"));
    fireEvent.click(screen.getByRole("button", { name: /save romm settings/i }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/settings/romm",
        expect.objectContaining({ platformFolders: true, apiToken: "********" })
      )
    );
    expect(apiRequest.mock.calls[0][2]).not.toHaveProperty("lastSync");
  });

  it("shows the outcome of a sync", async () => {
    apiRequest.mockResolvedValue({
      json: async () => ({
        summary: { totalRoms: 10, matched: 4, alreadyOwned: 1, markedOwned: 3, notInLibrary: 6 },
      }),
    });
    renderComponent();
    await screen.findByDisplayValue("http://romm.lan:8080");
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "10 ROMs in RomM: 4 matched, 3 marked as owned"
    );
  });
});
