/** @vitest-environment jsdom */
import { useState } from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingRow } from "@/components/ui/setting-row";

function Harness({ onChange = () => {} }: Readonly<{ onChange?: (value: boolean) => void }>) {
  const [checked, setChecked] = useState(false);
  return (
    <SettingRow
      id="demo"
      label="Demo setting"
      description="Explains the demo setting"
      checked={checked}
      onCheckedChange={(value) => {
        setChecked(value);
        onChange(value);
      }}
    />
  );
}

describe("SettingRow", () => {
  it("exposes the label and description on the switch", () => {
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Demo setting" });
    expect(toggle).toHaveAccessibleDescription("Explains the demo setting");
  });

  it("toggles when the row text is clicked, not only the switch", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByText("Explains the demo setting"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("toggles once when the switch itself is clicked", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not toggle when disabled", () => {
    const onChange = vi.fn();
    render(
      <SettingRow id="locked" label="Locked" checked={false} disabled onCheckedChange={onChange} />
    );
    fireEvent.click(screen.getByText("Locked"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
