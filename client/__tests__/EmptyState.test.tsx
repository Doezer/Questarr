/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import EmptyState from "../src/components/EmptyState";

function DummyIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg data-testid="dummy-icon" {...props} />;
}

describe("EmptyState", () => {
  it("renders title, description, and icon", () => {
    render(<EmptyState icon={DummyIcon} title="Nothing here" description="Add a game to start" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Add a game to start")).toBeInTheDocument();
    expect(screen.getByTestId("dummy-icon")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });

  it("renders a link action when actionLabel and actionLink are provided", () => {
    render(
      <EmptyState
        icon={DummyIcon}
        title="No results"
        description="Try another search"
        actionLabel="Go to library"
        actionLink="/library"
      />
    );

    const link = screen.getByRole("link", { name: "Go to library" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/library");
  });

  it("renders a button action and fires onAction when clicked", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={DummyIcon}
        title="No downloads"
        description="Start a download"
        actionLabel="Start"
        onAction={onAction}
      />
    );

    const button = screen.getByRole("button", { name: "Start" });
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("applies a custom className", () => {
    render(
      <EmptyState
        icon={DummyIcon}
        title="Custom"
        description="With class"
        className="my-custom-class"
      />
    );
    expect(screen.getByTestId("empty-state")).toHaveClass("my-custom-class");
  });

  it("omits action controls when no action props are provided", () => {
    render(<EmptyState icon={DummyIcon} title="No action" description="Nothing to do" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
