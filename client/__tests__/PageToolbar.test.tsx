/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import PageToolbar from "../src/components/PageToolbar";

vi.mock("lucide-react", () => ({
  Search: () => <div data-testid="icon-search" />,
  X: () => <div data-testid="icon-x" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  ChevronUp: () => <div data-testid="icon-chevron-up" />,
  Check: () => <div data-testid="icon-check" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="select-trigger">{children}</button>
  ),
  SelectValue: () => <span data-testid="select-value" />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-value={value}>{children}</div>
  ),
}));

vi.mock("../src/components/ViewControlsToolbar", () => ({
  default: ({ viewMode }: { viewMode: string }) => (
    <div data-testid="view-controls-toolbar" data-view-mode={viewMode} />
  ),
}));

describe("PageToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search input when onSearchChange is provided", () => {
    render(<PageToolbar search="" onSearchChange={vi.fn()} searchPlaceholder="Search games..." />);
    expect(screen.getByRole("textbox", { name: "Search games..." })).toBeInTheDocument();
  });

  it("does not render search input when onSearchChange is not provided", () => {
    render(<PageToolbar />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders clear button when search is non-empty", () => {
    render(<PageToolbar search="hello" onSearchChange={vi.fn()} />);
    expect(screen.getByLabelText("Clear search")).toBeInTheDocument();
  });

  it("calls onSearchChange with empty string when clear button is clicked", () => {
    const onSearchChange = vi.fn();
    render(<PageToolbar search="hello" onSearchChange={onSearchChange} />);
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("does not render clear button when search is empty", () => {
    render(<PageToolbar search="" onSearchChange={vi.fn()} />);
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("renders sort section when sortOptions and onSortChange are provided", () => {
    render(
      <PageToolbar
        sortValue="title-asc"
        onSortChange={vi.fn()}
        sortOptions={[
          { value: "title-asc", label: "Title A–Z" },
          { value: "title-desc", label: "Title Z–A" },
        ]}
      />
    );
    expect(screen.getByText("Sort")).toBeInTheDocument();
  });

  it("does not render sort section when sortOptions is empty", () => {
    render(<PageToolbar sortOptions={[]} onSortChange={vi.fn()} />);
    expect(screen.queryByText("Sort")).not.toBeInTheDocument();
  });

  it("renders ViewControlsToolbar when viewControls prop is provided", () => {
    render(
      <PageToolbar
        viewControls={{
          viewMode: "grid",
          onViewModeChange: vi.fn(),
          listDensity: "comfortable",
          onListDensityChange: vi.fn(),
        }}
      />
    );
    expect(screen.getByTestId("view-controls-toolbar")).toBeInTheDocument();
  });

  it("renders filterPills and actions slots", () => {
    render(
      <PageToolbar
        filterPills={<div data-testid="filter-pills">Pills</div>}
        actions={<button data-testid="action-btn">Action</button>}
      />
    );
    expect(screen.getByTestId("filter-pills")).toBeInTheDocument();
    expect(screen.getByTestId("action-btn")).toBeInTheDocument();
  });
});
