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

// Mock Radix UI DropdownMenu — renders content inline so items are always accessible
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren<{ asChild?: boolean }>) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
}));

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
    expect(screen.queryByTestId("dropdown-content")).not.toBeInTheDocument();
  });

  it("shows density options in list mode", () => {
    render(<ViewControlsToolbar {...defaultProps} viewMode="list" />);
    expect(screen.getByTestId("dropdown-content")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Comfortable" })).toBeInTheDocument();
  });

  it("calls onViewModeChange when list toggle clicked", () => {
    const onViewModeChange = vi.fn();
    render(<ViewControlsToolbar {...defaultProps} onViewModeChange={onViewModeChange} />);
    fireEvent.click(screen.getByLabelText("List View"));
    expect(onViewModeChange).toHaveBeenCalledWith("list");
  });

  it("shows current density label in list mode trigger button", () => {
    render(<ViewControlsToolbar {...defaultProps} viewMode="list" listDensity="compact" />);
    // The trigger button span shows the current density
    expect(screen.getAllByText("Compact").length).toBeGreaterThanOrEqual(1);
  });

  it("calls onListDensityChange with compact when Compact item clicked", () => {
    const onListDensityChange = vi.fn();
    render(
      <ViewControlsToolbar
        {...defaultProps}
        viewMode="list"
        onListDensityChange={onListDensityChange}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Compact" }));
    expect(onListDensityChange).toHaveBeenCalledWith("compact");
  });

  it("calls onListDensityChange with ultra-compact when Ultra-compact item clicked", () => {
    const onListDensityChange = vi.fn();
    render(
      <ViewControlsToolbar
        {...defaultProps}
        viewMode="list"
        onListDensityChange={onListDensityChange}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Ultra-compact" }));
    expect(onListDensityChange).toHaveBeenCalledWith("ultra-compact");
  });

  it("calls onListDensityChange with comfortable when Comfortable item clicked", () => {
    const onListDensityChange = vi.fn();
    render(
      <ViewControlsToolbar
        {...defaultProps}
        viewMode="list"
        listDensity="compact"
        onListDensityChange={onListDensityChange}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Comfortable" }));
    expect(onListDensityChange).toHaveBeenCalledWith("comfortable");
  });
});
