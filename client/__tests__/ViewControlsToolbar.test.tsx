/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ViewControlsToolbar from "../src/components/ViewControlsToolbar";
import { TooltipProvider } from "../src/components/ui/tooltip";
import "@testing-library/jest-dom";

// Mock lucide-react icons
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    LayoutGrid: () => <div data-testid="icon-layout-grid" />,
    List: () => <div data-testid="icon-list" />,
    Rows2: () => <div data-testid="icon-rows2" />,
    Rows3: () => <div data-testid="icon-rows3" />,
  };
});

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("ViewControlsToolbar", () => {
  const defaultProps = {
    viewMode: "grid" as const,
    onViewModeChange: vi.fn(),
    listDensity: "comfortable" as const,
    onListDensityChange: vi.fn(),
  };

  it("renders grid and list toggle buttons", () => {
    renderWithTooltip(<ViewControlsToolbar {...defaultProps} />);
    expect(screen.getByLabelText("Grid View")).toBeInTheDocument();
    expect(screen.getByLabelText("List View")).toBeInTheDocument();
  });

  it("does not show density button in grid mode", () => {
    renderWithTooltip(<ViewControlsToolbar {...defaultProps} viewMode="grid" />);
    expect(screen.queryByText("Comfortable")).not.toBeInTheDocument();
    expect(screen.queryByText("Compact")).not.toBeInTheDocument();
  });

  it("shows density toggle button in list mode", () => {
    renderWithTooltip(<ViewControlsToolbar {...defaultProps} viewMode="list" />);
    expect(screen.getByText("Comfortable")).toBeInTheDocument();
  });

  it("calls onViewModeChange when list toggle clicked", () => {
    const onViewModeChange = vi.fn();
    renderWithTooltip(
      <ViewControlsToolbar {...defaultProps} onViewModeChange={onViewModeChange} />
    );
    fireEvent.click(screen.getByLabelText("List View"));
    expect(onViewModeChange).toHaveBeenCalledWith("list");
  });

  it("shows current density label in list mode trigger button", () => {
    renderWithTooltip(
      <ViewControlsToolbar {...defaultProps} viewMode="list" listDensity="compact" />
    );
    expect(screen.getByText("Compact")).toBeInTheDocument();
  });

  it("calls onListDensityChange with compact when button clicked in comfortable mode", () => {
    const onListDensityChange = vi.fn();
    renderWithTooltip(
      <ViewControlsToolbar
        {...defaultProps}
        viewMode="list"
        listDensity="comfortable"
        onListDensityChange={onListDensityChange}
      />
    );
    fireEvent.click(screen.getByText("Comfortable"));
    expect(onListDensityChange).toHaveBeenCalledWith("compact");
  });

  it("calls onListDensityChange with comfortable when button clicked in compact mode", () => {
    const onListDensityChange = vi.fn();
    renderWithTooltip(
      <ViewControlsToolbar
        {...defaultProps}
        viewMode="list"
        listDensity="compact"
        onListDensityChange={onListDensityChange}
      />
    );
    fireEvent.click(screen.getByText("Compact"));
    expect(onListDensityChange).toHaveBeenCalledWith("comfortable");
  });
});
