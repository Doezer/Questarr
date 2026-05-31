/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatusBadge, { getStatusLabel } from "../src/components/StatusBadge";

describe("StatusBadge", () => {
  it("returns known labels and falls back to the raw status", () => {
    expect(getStatusLabel("downloading")).toBe("Downloading");
    expect(getStatusLabel("queued")).toBe("queued");
  });

  it("renders the completed badge label", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByTestId("badge-status-completed")).toHaveTextContent("Completed");
  });

  it("renders unknown statuses without an icon fallback error", () => {
    render(<StatusBadge status="queued" />);
    expect(screen.getByTestId("badge-status-queued")).toHaveTextContent("queued");
  });
});
