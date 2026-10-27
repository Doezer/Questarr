/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import ClassificationReviewSettings from "@/components/ClassificationReviewSettings";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const candidate = {
  id: "c1",
  releaseName: "Stellaris.Mystery.Pack-GROUP",
  gameTitle: "Stellaris",
  reasons: ["unresolved", "disagreement"],
  signals: {
    rules: { class: "patch", flags: [], ruleIds: [] },
    local: { class: "dlc", confidence: 0.52, modelVersion: "m1" },
    final: { class: "unknown", confidence: null, source: "local", flags: [] },
  },
  priority: 90,
  seenCount: 2,
  suggestion: null,
};

const base = {
  collecting: true,
  cloudSuggest: false,
  cloudAvailable: false,
  labels: ["full_game", "patch", "dlc", "unknown"],
  counts: { pending: 1, verified: 3, ambiguous: 0, rejected: 0 },
  candidates: [candidate],
};

function renderCard(data: unknown) {
  const client = createTestQueryClient();
  client.setQueryData(["/api/classification-candidates"], data);
  return render(
    <QueryClientProvider client={client}>
      <ClassificationReviewSettings />
    </QueryClientProvider>
  );
}

describe("ClassificationReviewSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("renders nothing while collection is off and nothing was collected", () => {
    const { container } = renderCard({
      ...base,
      collecting: false,
      counts: { pending: 0, verified: 0, ambiguous: 0, rejected: 0 },
      candidates: [],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows what each layer said and prefills the local model's guess as a proposal", () => {
    renderCard(base);
    expect(screen.getByText("Stellaris.Mystery.Pack-GROUP")).toBeInTheDocument();
    expect(screen.getByText("Rules and model disagree")).toBeInTheDocument();
    expect(screen.getByText("dlc (52%)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Verify label/ })).toBeEnabled();
  });

  it("sends the proposed label as a verified correction", async () => {
    renderCard(base);
    fireEvent.click(screen.getByRole("button", { name: /Verify label/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/classification-candidates/c1/review", {
        action: "correct",
        label: "dlc",
      })
    );
  });

  it("sets a release aside as ambiguous or not an example", async () => {
    renderCard(base);
    fireEvent.click(screen.getByRole("button", { name: /Ambiguous/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/classification-candidates/c1/review", {
        action: "ambiguous",
      })
    );
    fireEvent.click(screen.getByRole("button", { name: /Not an example/ }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("POST", "/api/classification-candidates/c1/review", {
        action: "reject",
      })
    );
  });

  it("offers the paid cloud suggestion only when enabled and configured", () => {
    const { unmount } = renderCard(base);
    expect(screen.queryByRole("button", { name: /Ask the cloud model/ })).toBeNull();
    unmount();
    renderCard({ ...base, cloudSuggest: true, cloudAvailable: true });
    expect(screen.getByRole("button", { name: /Ask the cloud model/ })).toBeInTheDocument();
  });

  it("labels a cloud suggestion as not verified", () => {
    renderCard({
      ...base,
      candidates: [
        { ...candidate, suggestion: { label: "update", confidence: 0.8, model: "jev-latest" } },
      ],
    });
    expect(screen.getByText(/Cloud suggestion, not verified/)).toBeInTheDocument();
    expect(screen.getByText(/update \(80%, jev-latest\)/)).toBeInTheDocument();
  });

  it("asks before deleting every candidate", async () => {
    renderCard(base);
    fireEvent.click(screen.getByRole("button", { name: /Delete all candidates/ }));
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/classification-candidates")
    );
  });
});
