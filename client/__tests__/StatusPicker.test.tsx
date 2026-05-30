/** @vitest-environment jsdom */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import StatusPicker from "../src/components/StatusPicker";

// StatusBadge renders a badge with the status label — keep it real so chips are visible
// Popover from Radix renders via portal into document.body — no mock needed

describe("StatusPicker", () => {
  const onStatusChange = vi.fn();

  beforeEach(() => {
    onStatusChange.mockClear();
  });

  it("renders a trigger button with an accessible label", () => {
    render(
      <StatusPicker currentStatus="owned" onStatusChange={onStatusChange} gameTitle="Portal 2" />
    );
    expect(screen.getByRole("button", { name: /Change status for Portal 2/i })).toBeInTheDocument();
  });

  it("opens popover and shows all 4 user-settable status chips", async () => {
    render(
      <StatusPicker currentStatus="owned" onStatusChange={onStatusChange} gameTitle="Portal 2" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Change status for Portal 2/i }));

    // All four user-settable statuses must appear as chips
    expect(await screen.findByRole("button", { name: "wanted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "owned" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "shelved" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "completed" })).toBeInTheDocument();
  });

  it("does not show downloading as a selectable chip", async () => {
    render(
      <StatusPicker currentStatus="owned" onStatusChange={onStatusChange} gameTitle="Portal 2" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Change status for Portal 2/i }));
    await screen.findByRole("button", { name: "wanted" }); // wait for popover

    expect(screen.queryByRole("button", { name: "downloading" })).not.toBeInTheDocument();
  });

  it("marks the active status chip with aria-pressed=true", async () => {
    render(
      <StatusPicker currentStatus="shelved" onStatusChange={onStatusChange} gameTitle="Portal 2" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Change status for Portal 2/i }));
    const shelvedChip = await screen.findByRole("button", { name: "shelved" });

    expect(shelvedChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "owned" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onStatusChange with the selected status and closes popover", async () => {
    render(
      <StatusPicker currentStatus="owned" onStatusChange={onStatusChange} gameTitle="Portal 2" />
    );

    fireEvent.click(screen.getByRole("button", { name: /Change status for Portal 2/i }));
    const completedChip = await screen.findByRole("button", { name: "completed" });
    fireEvent.click(completedChip);

    expect(onStatusChange).toHaveBeenCalledOnce();
    expect(onStatusChange).toHaveBeenCalledWith("completed");

    // Popover should close — chips no longer visible
    expect(screen.queryByRole("button", { name: "completed" })).not.toBeInTheDocument();
  });

  it("renders as a non-interactive badge when status is downloading", () => {
    render(
      <StatusPicker
        currentStatus="downloading"
        onStatusChange={onStatusChange}
        gameTitle="Portal 2"
      />
    );

    // No trigger button — just the badge
    expect(
      screen.queryByRole("button", { name: /Change status for Portal 2/i })
    ).not.toBeInTheDocument();

    expect(screen.getByTestId("badge-status-downloading")).toBeInTheDocument();
  });

  it("renders a custom trigger when children are provided", async () => {
    render(
      <StatusPicker currentStatus="wanted" onStatusChange={onStatusChange} gameTitle="Portal 2">
        <button type="button" data-testid="custom-trigger">
          Custom
        </button>
      </StatusPicker>
    );

    const trigger = screen.getByTestId("custom-trigger");
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(await screen.findByRole("button", { name: "shelved" })).toBeInTheDocument();
  });
});
