/** @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HiddenPlatformsSettings from "../src/components/HiddenPlatformsSettings";
import { createTestQueryClient, getRequestUrl } from "./test-utils";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, apiRequest: vi.fn(async () => ({ json: async () => ({}) })) };
});

describe("HiddenPlatformsSettings race", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still pre-checks saved platforms when the IGDB list resolves before settings", async () => {
    let resolveSettings: (v: unknown) => void = () => {};
    const settingsGate = new Promise((r) => {
      resolveSettings = r;
    });

    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = getRequestUrl(url);
      if (u.includes("/api/settings")) {
        await settingsGate;
        return {
          ok: true,
          json: async () => ({ hiddenPlatforms: ["Nintendo Switch"] }),
        } as Response;
      }
      if (u.includes("/api/igdb/platforms")) {
        // Platforms resolve immediately — they win the race.
        return {
          ok: true,
          json: async () => [
            { id: 130, name: "Nintendo Switch" },
            { id: 6, name: "PC (Microsoft Windows)" },
          ],
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <HiddenPlatformsSettings />
      </QueryClientProvider>
    );

    await screen.findByLabelText("Nintendo Switch");
    resolveSettings(undefined);

    await waitFor(() => expect(screen.getByLabelText("Nintendo Switch")).toBeChecked());
  });
});
