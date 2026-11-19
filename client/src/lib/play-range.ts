export type PlayRangePreset = "all" | "7d" | "30d" | "90d" | "year" | "custom";

export const PLAY_RANGE_LABELS: Record<PlayRangePreset, string> = {
  all: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  year: "Last 12 months",
  custom: "Custom range",
};

/** `YYYY-MM-DD` of a date on the viewer's own calendar (not UTC). */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const PRESET_DAYS: Record<"7d" | "30d" | "90d" | "year", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  year: 365,
};

/** The inclusive local days a preset covers, ending today. `all` and an empty custom range are open. */
export function presetBounds(
  preset: PlayRangePreset,
  now: Date,
  custom: { from: string; to: string }
): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (preset === "custom") {
    return {
      ...(custom.from ? { from: custom.from } : {}),
      ...(custom.to ? { to: custom.to } : {}),
    };
  }
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (PRESET_DAYS[preset] - 1)
  );
  return { from: localDay(start), to: localDay(now) };
}
