/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHiddenMutation } from "../src/hooks/use-hidden-mutation";
import { apiRequest } from "@/lib/queryClient";

const toastSpy = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastSpy,
  }),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

function DefaultPayloadHarness() {
  const mutation = useHiddenMutation({
    hiddenSuccessMessage: "Hidden OK",
    unhiddenSuccessMessage: "Unhidden OK",
    errorMessage: "Hidden failed",
  });

  return (
    <>
      <button
        data-testid="button-hide"
        onClick={() => mutation.mutate({ gameId: "game-1", hidden: true })}
      >
        hide
      </button>
      <button
        data-testid="button-unhide"
        onClick={() => mutation.mutate({ gameId: "game-1", hidden: false })}
      >
        unhide
      </button>
      <button data-testid="button-invalid" onClick={() => mutation.mutate({} as never)}>
        invalid
      </button>
    </>
  );
}

function CustomMutationHarness() {
  const mutation = useHiddenMutation<{ id: string }>({
    mutationFn: async () => ({ hidden: true }),
    hiddenSuccessMessage: "Custom hidden",
  });

  return (
    <button data-testid="button-custom" onClick={() => mutation.mutate({ id: "abc" })}>
      custom
    </button>
  );
}

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe("useHiddenMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses default mode, calls API, and shows hidden/unhidden success messages", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      json: async () => ({ hidden: true }),
    } as Response);

    renderWithQueryClient(<DefaultPayloadHarness />);

    fireEvent.click(screen.getByTestId("button-hide"));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/games/game-1/hidden", {
        hidden: true,
      });
      expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ description: "Hidden OK" }));
    });

    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => ({ hidden: false }),
    } as Response);

    fireEvent.click(screen.getByTestId("button-unhide"));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Unhidden OK" })
      );
    });
  });

  it("returns custom mutationFn path without calling apiRequest", async () => {
    renderWithQueryClient(<CustomMutationHarness />);

    fireEvent.click(screen.getByTestId("button-custom"));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Custom hidden" })
      );
    });

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows error toast for invalid payload in default mode", async () => {
    renderWithQueryClient(<DefaultPayloadHarness />);

    fireEvent.click(screen.getByTestId("button-invalid"));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Hidden failed", variant: "destructive" })
      );
    });

    expect(apiRequest).not.toHaveBeenCalled();
  });
});
