/** @vitest-environment jsdom */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import ReleaseScoringSettings from "@/components/ReleaseScoringSettings";
import ReleaseScoreBadge, { XrelStatusBadge } from "@/components/ReleaseScoreBadge";
import { DEFAULT_RELEASE_PROFILE } from "@shared/release-scoring";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const response = {
  profile: DEFAULT_RELEASE_PROFILE,
  formats: [
    {
      id: "f1",
      name: "Trusted groups",
      specs: [{ field: "group", mode: "exact", value: "CODEX" }],
      score: 50,
      hardReject: false,
      enabled: true,
    },
  ],
  builtInRules: [
    { id: "repack", label: "Repack", points: 8, locked: false, rejects: false },
    { id: "title_sequel", label: "Sequel", points: -200, locked: true, rejects: true },
  ],
};

function renderSettings(maxSizeBytes: number | null = null) {
  const client = createTestQueryClient();
  client.setQueryData(["/api/release-scoring"], {
    ...response,
    profile: { ...response.profile, maxSizeBytes },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ReleaseScoringSettings />
      </QueryClientProvider>
    ),
  };
}

describe("ReleaseScoringSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("lists the custom formats and built-in rules", () => {
    renderSettings();
    expect(screen.getByText("Trusted groups")).toBeInTheDocument();
    expect(screen.getByLabelText("Repack points")).toHaveValue(8);
    expect(screen.getByLabelText("Enable Sequel")).toBeDisabled();
  });

  it("saves the profile with a changed rule weight", async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Repack points"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /Save profile and rules/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/release-profile",
        expect.objectContaining({
          minScore: 30,
          builtInOverrides: { repack: { points: 20 } },
        })
      )
    );
  });

  it("lets a rule weight be cleared and typed as a negative number", async () => {
    renderSettings();
    const input = screen.getByLabelText("Repack points") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "-5" } });
    expect(input.value).toBe("-5");
    fireEvent.click(screen.getByRole("button", { name: /Save profile and rules/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/release-profile",
        expect.objectContaining({ builtInOverrides: { repack: { points: -5 } } })
      )
    );
  });

  it("keeps a maximum size that is not a multiple of 0.1 GB when saving", async () => {
    renderSettings(1_250_000_000);
    expect(screen.getByLabelText("Maximum size (GB)")).toHaveValue(1.25);
    fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Save profile and rules/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/release-profile",
        expect.objectContaining({ maxSizeBytes: 1_250_000_000 })
      )
    );
  });

  it("keeps unsaved profile edits when a format refresh returns the same profile", async () => {
    const { client } = renderSettings();
    fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "42" } });

    act(() => {
      client.setQueryData(["/api/release-scoring"], {
        ...response,
        profile: { ...response.profile },
        formats: [...response.formats],
      });
    });

    expect(screen.getByLabelText("Minimum score")).toHaveValue(42);
  });

  it("creates a custom format from the dialog", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Add format/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "No demos" } });
    fireEvent.change(within(dialog).getByLabelText("Score"), { target: { value: "-100" } });
    fireEvent.change(within(dialog).getByLabelText("Condition 1 value"), {
      target: { value: "FitGirl" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Save format/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/custom-formats",
        expect.objectContaining({
          name: "No demos",
          score: -100,
          specs: [{ field: "group", mode: "exact", value: "FitGirl" }],
        })
      )
    );
  });

  it("rejects an unusable regex before saving", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Add format/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Bad" } });
    fireEvent.change(within(dialog).getByLabelText("Condition 1 value"), {
      target: { value: "(?=x)" },
    });
    fireEvent.click(within(dialog).getByRole("combobox", { name: /match mode/i }));
    fireEvent.click(await screen.findByRole("option", { name: "matches regex" }));
    expect(within(dialog).getByRole("button", { name: /Save format/i })).toBeDisabled();
  });

  it("scores a release name in the tester", async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Game title"), { target: { value: "Dishonored" } });
    fireEvent.change(screen.getByLabelText("Release name"), {
      target: { value: "Dishonored.2-CODEX" },
    });
    expect(await screen.findByLabelText(/rejected\. Show breakdown/)).toBeInTheDocument();
  });

  it("tests releases against the unsaved profile", async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Game title"), { target: { value: "Dishonored" } });
    fireEvent.change(screen.getByLabelText("Release name"), {
      target: { value: "Dishonored-CODEX" },
    });
    expect(await screen.findByLabelText(/accepted\. Show breakdown/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Minimum score"), { target: { value: "100000" } });
    expect(await screen.findByLabelText(/rejected\. Show breakdown/)).toBeInTheDocument();
  });
});

describe("ReleaseScoreBadge", () => {
  it("opens the breakdown with lines and rejections", async () => {
    render(
      <ReleaseScoreBadge
        evaluation={{
          accepted: false,
          score: 20,
          lines: [{ ruleId: "repack", label: "Repack", points: 8 }],
          rejections: [{ code: "title_sequel", detail: "2" }],
          titleMatch: "sequel",
          indexerCategory: "unknown",
          category: "main",
          matchedFormats: [],
          preferredProtocol: true,
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Score 20, rejected/ }));
    expect(await screen.findByText("The release is a sequel (2)")).toBeInTheDocument();
    expect(screen.getByText("+8")).toBeInTheDocument();
  });
});

describe("XrelStatusBadge", () => {
  const base = {
    accepted: true,
    score: 10,
    lines: [],
    rejections: [],
    titleMatch: "exact" as const,
    indexerCategory: "unknown" as const,
    category: "main" as const,
    matchedFormats: [],
    preferredProtocol: true,
  };

  it("labels verified, nuked and unlisted releases, and nothing without xREL data", () => {
    const { rerender, container } = render(<XrelStatusBadge evaluation={base} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<XrelStatusBadge evaluation={{ ...base, xrel: "verified" }} />);
    expect(screen.getByText("xREL")).toBeInTheDocument();
    rerender(<XrelStatusBadge evaluation={{ ...base, xrel: "not_found" }} />);
    expect(screen.getByText("Not on xREL")).toBeInTheDocument();
    rerender(
      <XrelStatusBadge evaluation={{ ...base, xrel: "nuked", xrelNukeReason: "bad crack" }} />
    );
    expect(screen.getByTitle("Nuked on xREL: bad crack")).toBeInTheDocument();
  });
});
