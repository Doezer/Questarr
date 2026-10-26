/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import UpdateAvailableBadge from "../src/components/UpdateAvailableBadge";

// Mock Tooltip
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("UpdateAvailableBadge", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(<UpdateAvailableBadge visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badge with arrow icon when visible=true", () => {
    render(<UpdateAvailableBadge visible={true} />);
    const badge = screen.getByRole("status", { name: "Update available on indexers" });
    expect(badge).toBeTruthy();
  });

  it("overlay variant has absolute class", () => {
    render(<UpdateAvailableBadge visible={true} variant="overlay" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("absolute");
  });

  it("inline variant does not have absolute class", () => {
    render(<UpdateAvailableBadge visible={true} variant="inline" />);
    const badge = screen.getByRole("status");
    expect(badge.className).not.toContain("absolute");
  });
});
