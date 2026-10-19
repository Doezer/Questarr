/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "./test-utils";
import ReleaseNameBlacklistSettings from "@/components/ReleaseNameBlacklistSettings";
import PreferredReleaseGroupsSettings from "@/components/PreferredReleaseGroupsSettings";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

function withClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createTestQueryClient()}>{ui}</QueryClientProvider>);
}

describe("ReleaseNameBlacklistSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("renders the initial terms and reports them to the parent", () => {
    const onTermsChange = vi.fn();
    withClient(
      <ReleaseNameBlacklistSettings blacklistTerms={["HYPERVISOR"]} onTermsChange={onTermsChange} />
    );
    expect(screen.getByText("HYPERVISOR")).toBeInTheDocument();
    expect(onTermsChange).toHaveBeenCalledWith(["HYPERVISOR"]);
  });

  it("saves the terms as a JSON string array", async () => {
    withClient(<ReleaseNameBlacklistSettings blacklistTerms={[]} onTermsChange={vi.fn()} />);
    const input = screen.getByLabelText("Blacklisted Terms");
    fireEvent.change(input, { target: { value: "HYPERVISOR" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Save Blacklist/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/settings", {
        releaseNameBlacklist: JSON.stringify(["HYPERVISOR"]),
      })
    );
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Release Blacklist Saved" })
      )
    );
  });

  it("clears all terms on reset", () => {
    withClient(
      <ReleaseNameBlacklistSettings
        blacklistTerms={["HYPERVISOR", "CAM"]}
        onTermsChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset/i }));
    expect(screen.queryByText("HYPERVISOR")).not.toBeInTheDocument();
    expect(
      screen.getByText("No blacklisted terms configured. All release names will be considered.")
    ).toBeInTheDocument();
  });

  it("shows a destructive toast when saving fails", async () => {
    apiRequest.mockRejectedValue(new Error("boom"));
    withClient(<ReleaseNameBlacklistSettings blacklistTerms={["CAM"]} onTermsChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Save Blacklist/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Save Failed", variant: "destructive" })
      )
    );
  });
});

describe("PreferredReleaseGroupsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiRequest.mockResolvedValue({ json: async () => ({}) });
  });

  it("saves the groups and the pre-filter flag", async () => {
    withClient(
      <PreferredReleaseGroupsSettings
        preferredGroups={[]}
        filterByPreferredGroups={false}
        onGroupsChange={vi.fn()}
        onFilterChange={vi.fn()}
      />
    );
    const input = screen.getByLabelText("Release Group Names");
    fireEvent.change(input, { target: { value: "CODEX" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Save Groups/i }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/settings", {
        preferredReleaseGroups: JSON.stringify(["CODEX"]),
        filterByPreferredGroups: true,
      })
    );
  });

  it("disables the pre-filter switch when there are no groups", () => {
    withClient(
      <PreferredReleaseGroupsSettings
        preferredGroups={[]}
        filterByPreferredGroups={false}
        onGroupsChange={vi.fn()}
        onFilterChange={vi.fn()}
      />
    );
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("clears groups and the pre-filter flag on reset", () => {
    const onFilterChange = vi.fn();
    withClient(
      <PreferredReleaseGroupsSettings
        preferredGroups={["SKIDROW"]}
        filterByPreferredGroups={true}
        onGroupsChange={vi.fn()}
        onFilterChange={onFilterChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset/i }));
    expect(screen.queryByText("SKIDROW")).not.toBeInTheDocument();
    expect(onFilterChange).toHaveBeenLastCalledWith(false);
  });
});
