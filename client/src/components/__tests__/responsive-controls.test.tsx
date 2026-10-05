import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StatusPicker from "../StatusPicker";
import { TagList } from "../ui/tag-list";

describe("responsive card controls", () => {
  it("uses the shortened status label and dimensions in compact mode", () => {
    render(
      <StatusPicker
        currentStatus="wanted"
        onStatusChange={vi.fn()}
        gameTitle="Example game"
        compact
      />
    );

    const trigger = screen.getByRole("button", { name: "Change status for Example game" });
    expect(trigger).toHaveTextContent("Wanted");
    expect(trigger).not.toHaveTextContent("Status:");
    expect(trigger).toHaveClass("h-8", "px-2");
  });

  it("keeps the descriptive status label outside compact mode", () => {
    render(
      <StatusPicker currentStatus="playing" onStatusChange={vi.fn()} gameTitle="Example game" />
    );

    const trigger = screen.getByRole("button", { name: "Change status for Example game" });
    expect(trigger).toHaveTextContent("Status: Playing");
    expect(trigger).toHaveClass("h-9", "px-3");
  });

  it("constrains a visible tag and summarizes the remaining tags", () => {
    render(
      <TagList
        items={["Hack and slash/Beat 'em up", "Adventure", "Role-playing (RPG)"]}
        maxVisible={1}
      />
    );

    const visibleTag = screen.getByTitle("Hack and slash/Beat 'em up");
    expect(visibleTag).toHaveClass("min-w-0", "max-w-full");
    expect(visibleTag.querySelector("span")).toHaveClass("truncate");
    expect(screen.getByRole("button", { name: "Show 2 more items" })).toHaveTextContent("+2 more");
    expect(screen.queryByText("Adventure")).not.toBeInTheDocument();
  });
});
