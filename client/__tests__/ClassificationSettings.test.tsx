/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import ClassificationSettings, {
  CLASSIFICATION_SETTINGS_KEY,
} from "@/components/ClassificationSettings";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const base = {
  settings: {
    mode: "hybrid",
    localThreshold: 0.7,
    holdUnknown: false,
    collect: false,
    cloudSuggest: false,
    lowConfidence: 0.85,
    maxCandidates: 5000,
  },
  locked: {},
  localModel: { installed: true, version: "tfidf-1", path: "/data/models/release-classifier.json" },
  cloud: { configured: false, model: "jev-latest" },
};

function renderCard(data: unknown) {
  const client = createTestQueryClient();
  client.setQueryData(CLASSIFICATION_SETTINGS_KEY, data);
  return render(
    <QueryClientProvider client={client}>
      <ClassificationSettings />
    </QueryClientProvider>
  );
}

const save = () => screen.getByRole("button", { name: /save classification settings/i });

describe("ClassificationSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("shows the current values and the state of the local model and cloud provider", () => {
    renderCard(base);
    expect(screen.getByLabelText("Local model confidence (%)")).toHaveValue("70");
    expect(screen.getByLabelText("Low-confidence below (%)")).toHaveValue("85");
    expect(screen.getByLabelText("Maximum candidates kept")).toHaveValue("5000");
    expect(screen.getByLabelText("Collect uncertain releases")).not.toBeChecked();
    expect(screen.getByText("Local model installed (tfidf-1)")).toBeInTheDocument();
    expect(screen.getByText("No cloud provider configured")).toBeInTheDocument();
  });

  it("saves every setting, with percentages turned back into fractions", async () => {
    renderCard(base);
    fireEvent.change(screen.getByLabelText("Local model confidence (%)"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByLabelText("Collect uncertain releases"));
    fireEvent.click(screen.getByLabelText("Hold unclassifiable releases"));
    fireEvent.change(screen.getByLabelText("Maximum candidates kept"), {
      target: { value: "1200" },
    });
    fireEvent.click(save());
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/settings/classification", {
      mode: "hybrid",
      localThreshold: 0.8,
      holdUnknown: true,
      collect: true,
      cloudSuggest: false,
      lowConfidence: 0.85,
      maxCandidates: 1200,
    });
  });

  it.each([
    ["Local model confidence (%)", "0"],
    ["Local model confidence (%)", "101"],
    ["Low-confidence below (%)", "abc"],
    ["Maximum candidates kept", "50"],
    ["Maximum candidates kept", "1.5"],
  ])("blocks saving when %s is %s", (label, value) => {
    renderCard(base);
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(save()).toBeDisabled();
  });

  it("shows a setting fixed by an environment variable read-only and never sends it", async () => {
    renderCard({
      ...base,
      locked: { mode: "CLASSIFICATION_MODE", collect: "ACTIVE_LEARNING_COLLECT" },
      settings: { ...base.settings, collect: true },
    });
    expect(screen.getByLabelText("Collect uncertain releases")).toBeDisabled();
    expect(screen.getByText(/CLASSIFICATION_MODE/)).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = apiRequest.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).not.toHaveProperty("mode");
    expect(body).not.toHaveProperty("collect");
    expect(body).toMatchObject({ holdUnknown: false, localThreshold: 0.7 });
  });

  it("says a cloud key is needed for suggestions when no provider is configured", () => {
    renderCard(base);
    expect(screen.getByText(/Needs a TypeSafe key\./)).toBeInTheDocument();
  });
});
