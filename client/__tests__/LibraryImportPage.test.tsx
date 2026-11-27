/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

const { manualImportRenderSpy } = vi.hoisted(() => ({ manualImportRenderSpy: vi.fn() }));

import LibraryImportPage from "../src/pages/library-import";

vi.mock("@/components/RootFolderDiscovery", () => ({
  RootFolderDiscovery: () => <div data-testid="root-folder-discovery" />,
}));

vi.mock("@/components/ManualImportModal", () => ({
  default: ({ open }: { open: boolean }) => {
    manualImportRenderSpy(open);
    return open ? <div data-testid="manual-import-modal">Manual import modal</div> : null;
  },
}));

describe("Library Import page", () => {
  it("opens Manual Import without replacing root-folder discovery", async () => {
    render(<LibraryImportPage />);

    expect(screen.getByTestId("root-folder-discovery")).toBeInTheDocument();
    await import("../src/components/ManualImportModal");
    expect(manualImportRenderSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Manual Import" }));

    expect(await screen.findByTestId("manual-import-modal")).toBeInTheDocument();
    expect(screen.getByTestId("root-folder-discovery")).toBeInTheDocument();
  });
});
