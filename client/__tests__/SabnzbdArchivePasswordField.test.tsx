/** @vitest-environment jsdom */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form } from "../src/components/ui/form";
import { SabnzbdArchivePasswordField } from "../src/pages/downloaders";
import type { InsertDownloader } from "@shared/schema";

function Harness({ initialSettings }: { initialSettings?: string }) {
  const form = useForm<InsertDownloader>({
    defaultValues: { settings: initialSettings } as Partial<InsertDownloader>,
  });
  return (
    <Form {...form}>
      <SabnzbdArchivePasswordField form={form} />
    </Form>
  );
}

describe("SabnzbdArchivePasswordField", () => {
  it("renders empty when no archive password is stored", () => {
    render(<Harness />);
    expect(screen.getByText("Default Archive Password (Optional)")).toBeInTheDocument();
    expect(screen.getByTestId("input-downloader-archive-password")).toHaveValue("");
  });

  it("shows the previously saved archive password", () => {
    render(<Harness initialSettings={JSON.stringify({ archivePassword: "404" })} />);
    expect(screen.getByTestId("input-downloader-archive-password")).toHaveValue("404");
  });

  it("saves a typed password into the form's settings JSON", () => {
    render(<Harness />);
    const input = screen.getByTestId("input-downloader-archive-password");
    fireEvent.change(input, { target: { value: "404" } });
    expect(input).toHaveValue("404");
  });
});
