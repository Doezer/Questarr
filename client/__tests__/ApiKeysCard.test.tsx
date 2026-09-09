/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import { ApiKeysCard } from "@/components/ApiKeysCard";
import type { ApiKeyPublicResponse } from "@shared/schema";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const copyToClipboard = vi.fn();
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    copyToClipboard: (...args: [string]) => copyToClipboard(...args),
  };
});

const sampleKey: ApiKeyPublicResponse = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: "user-1",
  name: "Living room PC",
  prefix: "qsr_abc12345",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
};

function mockList(keys: ApiKeyPublicResponse[]) {
  apiRequest.mockImplementation(async (method: string) => {
    if (method === "GET") {
      return { json: async () => keys };
    }
    return { json: async () => ({}) };
  });
}

function renderCard() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ApiKeysCard />
    </QueryClientProvider>
  );
}

describe("ApiKeysCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no keys", async () => {
    mockList([]);
    renderCard();

    expect(
      await screen.findByText("No API keys yet. Create one to connect the Playnite extension.")
    ).toBeInTheDocument();
  });

  it("shows a load-error state instead of an empty state when the list request fails", async () => {
    apiRequest.mockRejectedValue(new Error("network down"));
    renderCard();

    expect(
      await screen.findByText("Could not load API keys. Refresh the page to try again.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No API keys yet. Create one to connect the Playnite extension.")
    ).not.toBeInTheDocument();
  });

  it("renders each key's name, prefix, and formatted dates, including never-used and invalid dates", async () => {
    mockList([
      sampleKey,
      { ...sampleKey, id: "key-2", name: "Bad date", createdAt: "not-a-date", lastUsedAt: null },
    ]);
    renderCard();

    expect(await screen.findByText("Living room PC")).toBeInTheDocument();
    expect(screen.getAllByText(/qsr_abc12345…/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Last used Never/).length).toBe(2);

    expect(screen.getByText("Bad date")).toBeInTheDocument();
    expect(screen.getAllByText(/Created Unknown/).length).toBeGreaterThan(0);
  });

  it("disables the create button until a non-blank name is entered", async () => {
    mockList([]);
    renderCard();
    await screen.findByText("No API keys yet. Create one to connect the Playnite extension.");

    const createButton = screen.getByRole("button", { name: "Create key" });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My PC" } });
    expect(createButton).not.toBeDisabled();
  });

  it("creates a key, shows the one-time secret panel, and clears the name field", async () => {
    mockList([]);
    renderCard();
    await screen.findByText("No API keys yet. Create one to connect the Playnite extension.");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [] };
      return {
        json: async () => ({ ...sampleKey, key: "qsr_rawsecretvalue" }),
      };
    });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My PC" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/api-keys", { name: "My PC" });
    });

    expect(
      await screen.findByText("Copy your new key now — it will not be shown again.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New API key")).toHaveValue("qsr_rawsecretvalue");
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("shows an error toast when key creation fails", async () => {
    mockList([]);
    renderCard();
    await screen.findByText("No API keys yet. Create one to connect the Playnite extension.");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [] };
      throw new Error("limit reached");
    });

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My PC" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Could not create API key",
        description: "limit reached",
        variant: "destructive",
      });
    });
  });

  it("copies the new key to the clipboard and lets the user dismiss the panel", async () => {
    mockList([]);
    renderCard();
    await screen.findByText("No API keys yet. Create one to connect the Playnite extension.");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [] };
      return { json: async () => ({ ...sampleKey, key: "qsr_rawsecretvalue" }) };
    });
    copyToClipboard.mockResolvedValue(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My PC" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await screen.findByLabelText("New API key");

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith("qsr_rawsecretvalue");
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByText("Copy your new key now — it will not be shown again.")
    ).not.toBeInTheDocument();
  });

  it("shows a toast when the clipboard copy fails", async () => {
    mockList([]);
    renderCard();
    await screen.findByText("No API keys yet. Create one to connect the Playnite extension.");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [] };
      return { json: async () => ({ ...sampleKey, key: "qsr_rawsecretvalue" }) };
    });
    copyToClipboard.mockResolvedValue(false);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My PC" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await screen.findByLabelText("New API key");

    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Copy failed",
        description: "Select the key and copy it manually.",
        variant: "destructive",
      });
    });
  });

  it("asks for confirmation before revoking, and does nothing on cancel", async () => {
    mockList([sampleKey]);
    renderCard();
    await screen.findByText("Living room PC");

    fireEvent.click(screen.getByRole("button", { name: "Revoke API key Living room PC" }));
    expect(await screen.findByText("Revoke this API key?")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Living room PC");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Revoke this API key?")).not.toBeInTheDocument();
    });
    expect(apiRequest).not.toHaveBeenCalledWith("DELETE", expect.anything());
  });

  it("revokes the key on confirm and shows a success toast", async () => {
    mockList([sampleKey]);
    renderCard();
    await screen.findByText("Living room PC");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [sampleKey] };
      return { json: async () => ({}) };
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke API key Living room PC" }));
    await screen.findByText("Revoke this API key?");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("DELETE", `/api/api-keys/${sampleKey.id}`);
    });
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({ title: "API key revoked" });
    });
  });

  it("shows an error toast when revoking fails", async () => {
    mockList([sampleKey]);
    renderCard();
    await screen.findByText("Living room PC");

    apiRequest.mockImplementation(async (method: string) => {
      if (method === "GET") return { json: async () => [sampleKey] };
      throw new Error("not found");
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke API key Living room PC" }));
    await screen.findByText("Revoke this API key?");
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Could not revoke API key",
        description: "not found",
        variant: "destructive",
      });
    });
  });
});
