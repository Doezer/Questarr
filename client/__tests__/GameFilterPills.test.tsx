/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import GameFilterPills from "../src/components/GameFilterPills";
import { TooltipProvider } from "../src/components/ui/tooltip";

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="icon" />;
  return { Search: Icon, Download: Icon, RefreshCw: Icon };
});

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("GameFilterPills", () => {
  it("toggles search results and downloads filters", () => {
    const setShowSearchResultsOnly = vi.fn();
    const setShowDownloadsOnly = vi.fn();

    renderWithTooltip(
      <GameFilterPills
        showSearchResultsOnly={false}
        setShowSearchResultsOnly={setShowSearchResultsOnly}
        showDownloadsOnly={false}
        setShowDownloadsOnly={setShowDownloadsOnly}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show games with search results only" }));
    fireEvent.click(screen.getByRole("button", { name: "Show games with downloads only" }));

    expect(setShowSearchResultsOnly).toHaveBeenCalledWith(true);
    expect(setShowDownloadsOnly).toHaveBeenCalledTimes(1);
    expect(setShowDownloadsOnly.mock.calls[0][0](false)).toBe(true);
  });

  it("renders and toggles the update-available pill when enabled", () => {
    const setShowUpdateAvailableOnly = vi.fn();

    renderWithTooltip(
      <GameFilterPills
        showSearchResultsOnly={false}
        setShowSearchResultsOnly={vi.fn()}
        showDownloadsOnly
        setShowDownloadsOnly={vi.fn()}
        showUpdateAvailableOnly={false}
        setShowUpdateAvailableOnly={setShowUpdateAvailableOnly}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Show games with update downloads only" }));

    expect(setShowUpdateAvailableOnly).toHaveBeenCalledTimes(1);
    expect(setShowUpdateAvailableOnly.mock.calls[0][0](false)).toBe(true);
  });
});
