/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import SearchResultsBadge from "../src/components/SearchResultsBadge";

// Mock Tooltip
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("SearchResultsBadge", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(<SearchResultsBadge visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badge with Search icon when visible=true", () => {
    render(<SearchResultsBadge visible={true} />);
    const badge = screen.getByRole("status", { name: "Downloads available on indexers" });
    expect(badge).toBeTruthy();
  });

  it("overlay variant has absolute class", () => {
    render(<SearchResultsBadge visible={true} variant="overlay" />);
    const badge = screen.getByRole("status");
    expect(badge.className).toContain("absolute");
  });

  it("inline variant does not have absolute class", () => {
    render(<SearchResultsBadge visible={true} variant="inline" />);
    const badge = screen.getByRole("status");
    expect(badge.className).not.toContain("absolute");
  });
});
