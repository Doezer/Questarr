/** @vitest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@radix-ui/react-scroll-area", () => ({
  Root: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  Viewport: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  ScrollAreaScrollbar: ({
    children,
    forceMount,
    orientation,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    forceMount?: boolean;
    orientation?: "horizontal" | "vertical";
  }) => (
    <div
      data-testid="scrollbar"
      data-force-mount={String(forceMount)}
      data-orientation={orientation}
      {...props}
    >
      {children}
    </div>
  ),
  ScrollAreaThumb: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  Corner: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

import { ScrollArea } from "../src/components/ui/scroll-area";

describe("ScrollArea", () => {
  it("keeps the vertical scrollbar mounted with persistent thumb styling", () => {
    const { container } = render(
      <ScrollArea className="h-20">
        <div>Short content</div>
      </ScrollArea>
    );

    const scrollbar = container.querySelector<HTMLElement>('[data-testid="scrollbar"]');
    expect(scrollbar).not.toBeNull();
    expect(scrollbar).toHaveAttribute("data-force-mount", "true");
    expect(scrollbar).toHaveAttribute("data-orientation", "vertical");
    expect(scrollbar).toHaveClass("[&>div]:bg-border/60");
    expect(scrollbar).toHaveClass("[&>div]:hover:bg-border");
    expect(scrollbar).toHaveClass("[&>div]:transition-colors");
  });
});
