import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AutoDownloadRulesSettings from "../src/components/AutoDownloadRulesSettings";
import type { DownloadRules } from "@shared/schema";

const BASE_RULES: DownloadRules = {
  minSeeders: 0,
  sortBy: "seeders",
  visibleCategories: ["main", "update", "dlc", "extra"],
  hideRejected: true,
  autoPickBest: false,
  upgradeCutoffScore: 150,
  upgradeMinScoreGain: 10,
  upgradePreferPatches: false,
  autoIncludeUpdates: false,
  bundleExtraMaxPercent: 25,
};

/** Feeds the rules back in as the settings page does, and exposes the latest ones. */
function Harness({ onRules }: { onRules: (rules: DownloadRules) => void }) {
  const [rules, setRules] = useState<DownloadRules>(BASE_RULES);
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AutoDownloadRulesSettings
        rules={rules}
        onChange={(next) => {
          setRules(next);
          onRules(next);
        }}
        onReset={vi.fn()}
      />
    </QueryClientProvider>
  );
}

describe("AutoDownloadRulesSettings upgrade swap fields", () => {
  it("lets the cutoff be cleared and retyped without snapping to the default", () => {
    const onRules = vi.fn();
    render(<Harness onRules={onRules} />);
    const cutoff = screen.getByLabelText("Stop at score") as HTMLInputElement;

    fireEvent.change(cutoff, { target: { value: "" } });
    expect(cutoff.value).toBe("");
    expect(onRules.mock.lastCall?.[0].upgradeCutoffScore).toBe(150);

    fireEvent.change(cutoff, { target: { value: "120" } });
    expect(cutoff.value).toBe("120");
    expect(onRules.mock.lastCall?.[0].upgradeCutoffScore).toBe(120);
  });

  it("accepts a negative cutoff", () => {
    const onRules = vi.fn();
    render(<Harness onRules={onRules} />);
    const cutoff = screen.getByLabelText("Stop at score") as HTMLInputElement;

    fireEvent.change(cutoff, { target: { value: "-50" } });

    expect(cutoff.value).toBe("-50");
    expect(onRules.mock.lastCall?.[0].upgradeCutoffScore).toBe(-50);
  });

  it("shows the clamped value again when a field loses focus", () => {
    const onRules = vi.fn();
    render(<Harness onRules={onRules} />);
    const gain = screen.getByLabelText("Minimum score gain") as HTMLInputElement;

    fireEvent.change(gain, { target: { value: "0" } });
    expect(onRules.mock.lastCall?.[0].upgradeMinScoreGain).toBe(1);
    fireEvent.blur(gain);
    expect(gain.value).toBe("1");

    fireEvent.change(gain, { target: { value: "" } });
    fireEvent.blur(gain);
    expect(gain.value).toBe("1");
  });
});
