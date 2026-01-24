// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EmptyState } from "../components/EmptyState";
import { Gamepad2 } from "lucide-react";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState
        title="Test Title"
        description="Test Description"
      />
    );
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Test Description")).toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(
      <EmptyState
        title="Test"
        description="Test"
        icon={Gamepad2}
      />
    );
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("renders action button and handles click", () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="Test"
        description="Test"
        action={{ label: "Click Me", onClick: handleClick }}
      />
    );
    const button = screen.getByText("Click Me");
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalled();
  });
});
