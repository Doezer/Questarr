/** Formats minutes as `45m`, `2h` or `2h 05m`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, "0")}m`;
}

/** Formats a running timer as `0:07:09` (hours, minutes, seconds). */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Whole minutes a finished session lasted, or 0 while it is still running. */
export function sessionLengthMinutes(startedAt: string | Date, endedAt: string | Date | null) {
  if (!endedAt) return 0;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.max(0, Math.round(ms / 60_000));
}

/** A readable countdown to a "finish by" day (`daysLeft` from `computeGoalProgress`). */
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft < 0) {
    const late = -daysLeft;
    return `${late} day${late === 1 ? "" : "s"} overdue`;
  }
  if (daysLeft === 0) return "Last day";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
}

/** Label and badge colours for each goal status; colours use `in-[.dark]:` (Tailwind 4). */
export const GOAL_STATUS_STYLE: Record<
  "done" | "overdue" | "on-track" | "behind" | "no-estimate",
  { label: string; className: string }
> = {
  done: {
    label: "Done",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 in-[.dark]:text-emerald-300",
  },
  "on-track": {
    label: "On track",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 in-[.dark]:text-emerald-300",
  },
  behind: {
    label: "Behind",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 in-[.dark]:text-amber-300",
  },
  overdue: {
    label: "Overdue",
    className: "border-red-500/40 bg-red-500/10 text-red-700 in-[.dark]:text-red-300",
  },
  "no-estimate": {
    label: "No estimate",
    className: "border-border text-muted-foreground",
  },
};
