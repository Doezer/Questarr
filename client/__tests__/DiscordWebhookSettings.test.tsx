/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import DiscordWebhookSettings from "../src/components/DiscordWebhookSettings";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

function mockGetDiscordSettings(configured: boolean) {
  apiRequest.mockImplementation(async (method: string) => {
    if (method === "GET") {
      return { json: async () => ({ configured }) };
    }
    return { json: async () => ({ success: true }) };
  });
}

async function openPopover() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <DiscordWebhookSettings />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole("button", { name: "Configure Discord webhook" }));
  await screen.findByText("Discord Webhook");
}

describe("DiscordWebhookSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Not configured' and an empty input when no webhook is set", async () => {
    mockGetDiscordSettings(false);
    await openPopover();

    expect(await screen.findByText("Not configured")).toBeInTheDocument();
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows 'Configured' and leaves the input blank (never pre-fills the redacted secret)", async () => {
    mockGetDiscordSettings(true);
    await openPopover();

    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
    // Save is enabled even with an empty field, since that's how an existing webhook is cleared.
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  it("toggles the webhook URL input between hidden and visible", async () => {
    mockGetDiscordSettings(false);
    await openPopover();

    const input = screen.getByLabelText("Webhook URL");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show webhook URL" }));
    expect(input).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Hide webhook URL" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("saves a newly entered webhook URL", async () => {
    mockGetDiscordSettings(false);
    await openPopover();

    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "https://discord.com/api/webhooks/123/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/settings/discord", {
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      });
    });
    expect(mockToast).toHaveBeenCalledWith({ title: "Discord webhook saved" });
  });

  it("saves an empty value to clear an existing webhook", async () => {
    mockGetDiscordSettings(true);
    await openPopover();
    await screen.findByText("Configured");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/settings/discord", {
        webhookUrl: "",
      });
    });
  });
});
