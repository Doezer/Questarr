/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ViewControlsToolbar from "../src/components/ViewControlsToolbar";
import "@testing-library/jest-dom";

// Mock lucide-react icons
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    LayoutGrid: () => <div data-testid="icon-layout-grid" />,
    List: () => <div data-testid="icon-list" />,
    Settings2: () => <div data-testid="icon-settings2" />,
  };
});

describe("ViewControlsToolbar", () => {
  const defaultProps = {
    viewMode: "grid" as const,
    onViewModeChange: vi.fn(),
    listDensity: "comfortable" as const,
    onListDensityChange: vi.fn(),
  };

  it("renders grid and list toggle buttons", () => {
    render(<ViewControlsToolbar {...defaultProps} />);
    expect(screen.getByLabelText("Grid View")).toBeInTheDocument();
    expect(screen.getByLabelText("List View")).toBeInTheDocument();
  });

  it("does not show density dropdown in grid mode", () => {
    render(<ViewControlsToolbar {...defaultProps} viewMode="grid" />);
    expect(screen.queryByText("Comfortable")).not.toBeInTheDocument();
  });

  it("shows density dropdown in list mode", async () => {
    render(<ViewControlsToolbar {...defaultProps} viewMode="list" />);
    // The trigger button shows the current density label
    expect(screen.getByText("Comfortable")).toBeInTheDocument();
  });

  it("calls onViewModeChange when list toggle clicked", () => {
    const onViewModeChange = vi.fn();
    render(<ViewControlsToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);
    fireEvent.click(screen.getByLabelText("List View"));
    expect(onViewModeChange).toHaveBeenCalledWith("list");
  });

  it("shows density label in list mode trigger button", () => {
    render(<ViewControlsToolbar {...defaultProps} viewMode="list" listDensity="compact" />);
    expect(screen.getByText("Compact")).toBeInTheDocument();
  });
});
