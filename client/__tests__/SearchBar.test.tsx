/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SearchBar from "../src/components/SearchBar";
import React from "react";

describe("SearchBar", () => {
  it("should have accessible icon buttons with aria-labels", () => {
    render(<SearchBar activeFilters={["Action"]} />);

    // Check for the main search button
    expect(screen.getByLabelText("Search")).toBeDefined();

    // Check for the filter toggle button
    expect(screen.getByLabelText("Toggle filters")).toBeDefined();

    // Check for the remove filter button
    expect(screen.getByLabelText("Remove filter: Action")).toBeDefined();
  });
});
