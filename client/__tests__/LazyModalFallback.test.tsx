/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom";
import LazyModalFallback from "../src/components/LazyModalFallback";

describe("LazyModalFallback", () => {
  it("renders a loading status with default message", () => {
    render(<LazyModalFallback />);

    expect(screen.getByTestId("lazy-modal-fallback")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
  });

  it("renders a custom loading message", () => {
    render(<LazyModalFallback message="Loading game details..." />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading game details...");
  });
});
