/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import { Toggle } from "../src/components/ui/toggle";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/ui/table";
import { Toaster } from "../src/components/ui/toaster";

const mockToasts = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toasts: mockToasts.current }),
}));

describe("Toggle", () => {
  it("toggles pressed state on click and calls onPressedChange", () => {
    const onPressedChange = vi.fn();
    render(
      <Toggle aria-label="Bold" onPressedChange={onPressedChange}>
        B
      </Toggle>
    );

    const button = screen.getByRole("button", { name: "Bold" });
    expect(button).toHaveAttribute("data-state", "off");

    fireEvent.click(button);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it("applies outline variant and size classes", () => {
    render(
      <Toggle aria-label="Italic" variant="outline" size="sm">
        I
      </Toggle>
    );
    const button = screen.getByRole("button", { name: "Italic" });
    expect(button.className).toContain("border-input");
    expect(button.className).toContain("h-9");
  });
});

describe("Table", () => {
  it("renders a full table structure with header, body, footer, and caption", () => {
    render(
      <Table>
        <TableCaption>My caption</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Row value</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Footer value</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    );

    expect(screen.getByText("My caption")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Row value")).toBeInTheDocument();
    expect(screen.getByText("Footer value")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("Toaster", () => {
  it("renders nothing when there are no toasts", () => {
    mockToasts.current = [];
    const { container } = render(<Toaster />);
    expect(container.querySelectorAll("[data-testid]").length).toBe(0);
  });

  it("renders a toast with title, description, and action", () => {
    mockToasts.current = [
      {
        id: "t1",
        title: "Saved",
        description: "Your changes were saved.",
        action: <button>Undo</button>,
        open: true,
      },
    ];
    render(<Toaster />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your changes were saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("renders a toast without a title or description", () => {
    mockToasts.current = [{ id: "t2", open: true }];
    render(<Toaster />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("undefined");
  });
});
