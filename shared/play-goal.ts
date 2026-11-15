/**
 * Per-game "finish by" goals: how a target date compares with the IGDB Time to Beat and the
 * time already played. Pure functions (no clock, no database) shared by the server and the client.
 */

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

/** Days of play looked at to estimate the user's current pace on a game. */
export const GOAL_PACE_WINDOW_DAYS = 14;

export type PlayGoalStatus =
  /** The game is marked completed. */
  | "done"
  /** The target date is before today and the game is not completed. */
  | "overdue"
  /** The pace needed is no higher than the recent pace. */
  | "on-track"
  /** The pace needed is higher than the recent pace. */
  | "behind"
  /** No Time to Beat estimate: only the countdown is known. */
  | "no-estimate";

export interface PlayGoalInput {
  /** Target day, `YYYY-MM-DD`. */
  finishBy: string;
  /** Local calendar day today, `YYYY-MM-DD`. */
  today: string;
  gameStatus: string;
  playedMinutes: number;
  /** Minutes played over the last `GOAL_PACE_WINDOW_DAYS` days. */
  recentMinutes: number;
  /** IGDB "normally" estimate, in hours. */
  timeToBeatHours: number | null | undefined;
}

export interface PlayGoalProgress {
  status: PlayGoalStatus;
  /** Whole days from today to the target (negative once past; 0 on the day itself). */
  daysLeft: number;
  /** Time to Beat minus time played, never negative; `null` without an estimate. */
  remainingMinutes: number | null;
  /** Minutes per day needed from today to the target day included; `null` when not applicable. */
  neededMinutesPerDay: number | null;
  /** Average minutes per day over the pace window. */
  recentMinutesPerDay: number;
}

/** True for a real calendar day written `YYYY-MM-DD`. */
export function isValidFinishByDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dayNumber(value: string): number {
  return Math.floor(new Date(`${value}T00:00:00Z`).getTime() / DAY_MS);
}

export function computeGoalProgress(input: PlayGoalInput): PlayGoalProgress {
  const daysLeft = dayNumber(input.finishBy) - dayNumber(input.today);
  const recentMinutesPerDay = input.recentMinutes / GOAL_PACE_WINDOW_DAYS;
  const estimate = input.timeToBeatHours ? input.timeToBeatHours * 60 : null;
  const remainingMinutes =
    estimate === null ? null : Math.max(0, Math.round(estimate - input.playedMinutes));
  // The target day itself is still playable, hence + 1.
  const neededMinutesPerDay =
    remainingMinutes === null || daysLeft < 0 ? null : remainingMinutes / (daysLeft + 1);

  let status: PlayGoalStatus;
  if (input.gameStatus === "completed") status = "done";
  else if (daysLeft < 0) status = "overdue";
  else if (neededMinutesPerDay === null) status = "no-estimate";
  else status = neededMinutesPerDay <= recentMinutesPerDay ? "on-track" : "behind";

  return { status, daysLeft, remainingMinutes, neededMinutesPerDay, recentMinutesPerDay };
}

/** Minutes of finished sessions that ended within the pace window before `now`. */
export function recentPlayMinutes(
  sessions: readonly { startedAt: Date | string; endedAt: Date | string | null }[],
  now: Date
): number {
  const since = now.getTime() - GOAL_PACE_WINDOW_DAYS * DAY_MS;
  let total = 0;
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const end = new Date(s.endedAt).getTime();
    if (end < since) continue;
    total += Math.max(0, Math.round((end - new Date(s.startedAt).getTime()) / MINUTE_MS));
  }
  return total;
}
