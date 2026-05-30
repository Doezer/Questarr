/** @vitest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";

import PageHeader from "../src/components/PageHeader";

describe("PageHeader", () => {
  it("renders title, description, actions, and custom className", () => {
    render(
      <PageHeader
        title="Downloads"
        description="Manage active downloads"
        className="custom-header"
        actions={<button>Refresh</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "Downloads" })).toBeInTheDocument();
    expect(screen.getByText("Manage active downloads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(
      screen.getByText("Manage active downloads").closest(".custom-header")
    ).toBeInTheDocument();
  });

  it("omits optional description and actions when not provided", () => {
    render(<PageHeader title="Calendar" />);

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
