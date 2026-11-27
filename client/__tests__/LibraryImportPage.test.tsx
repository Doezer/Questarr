/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import LibraryImportPage from "../src/pages/library-import";

vi.mock("@/components/RootFolderDiscovery", () => ({
  RootFolderDiscovery: () => <div data-testid="root-folder-discovery" />,
}));

vi.mock("@/components/ManualImportModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="manual-import-modal">Manual import modal</div> : null,
}));

describe("Library Import page", () => {
  it("opens Manual Import without replacing root-folder discovery", async () => {
    render(<LibraryImportPage />);

    expect(screen.getByTestId("root-folder-discovery")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manual Import" }));

    expect(await screen.findByTestId("manual-import-modal")).toBeInTheDocument();
    expect(screen.getByTestId("root-folder-discovery")).toBeInTheDocument();
  });
});
