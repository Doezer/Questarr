/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import MobileBottomNav from "../src/components/MobileBottomNav";

vi.mock("lucide-react", () => {
  const Icon = () => <svg data-testid="icon" />;
  return {
    ClipboardList: Icon,
    MoreHorizontal: Icon,
    Calendar: Icon,
    Compass: Icon,
    Database: Icon,
    Download: Icon,
    HardDrive: Icon,
    Home: Icon,
    Newspaper: Icon,
    PieChart: Icon,
    Rss: Icon,
    ScrollText: Icon,
    Search: Icon,
    Settings: Icon,
    Star: Icon,
  };
});

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (
    <div data-open={open}>{children}</div>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("MobileBottomNav", () => {
  it("navigates directly from pinned items", () => {
    const onNavigate = vi.fn();
    render(<MobileBottomNav activeItem="/discover" onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: "Downloads" }));

    expect(onNavigate).toHaveBeenCalledWith("/downloads");
  });

  it("marks the active pinned page", () => {
    render(<MobileBottomNav activeItem="/downloads" onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Downloads" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("button", { name: "More navigation options" })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("marks More as active for non-pinned pages and navigates from the sheet", () => {
    const onNavigate = vi.fn();
    render(<MobileBottomNav activeItem="/settings" onNavigate={onNavigate} />);

    const moreButton = screen.getByRole("button", { name: "More navigation options" });
    expect(moreButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(moreButton);
    expect(moreButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(onNavigate).toHaveBeenCalledWith("/logs");
    expect(moreButton).toHaveAttribute("aria-expanded", "false");
  });

  it("does not treat login as a More page and shows section headings in the sheet", () => {
    render(<MobileBottomNav activeItem="/login" onNavigate={vi.fn()} />);

    const moreButton = screen.getByRole("button", { name: "More navigation options" });
    expect(moreButton).not.toHaveAttribute("aria-current");

    fireEvent.click(moreButton);

    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Management")).toBeInTheDocument();
  });

  it("does not treat setup as a More page", () => {
    render(<MobileBottomNav activeItem="/setup" onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "More navigation options" })).not.toHaveAttribute(
      "aria-current"
    );
  });
});
