import type { Request } from "express";
import { query } from "express-validator";
import { isValidTimeZone, type PlayStatsZone } from "../shared/play-stats.js";

/** True when `value` is a usable `getTimezoneOffset()` query value. */
function hasValidOffset(value: unknown): boolean {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) return false;
  const minutes = Number.parseInt(value, 10);
  return minutes >= -840 && minutes <= 840;
}

/**
 * Validators for the viewer's clock on stats routes: `timeZone` (IANA name) and `tz`
 * (`getTimezoneOffset()`). A zone this runtime does not know is tolerated when a valid `tz` offset
 * comes along.
 */
export const zoneQueryValidators = [
  query("tz").optional().isInt({ min: -840, max: 840 }).withMessage("Invalid time zone offset"),
  query("timeZone")
    .optional()
    .isString()
    .isLength({ max: 64 })
    .custom((value: string, { req }) => isValidTimeZone(value) || hasValidOffset(req.query?.tz))
    .withMessage("Invalid time zone"),
];

/** The zone a validated request asks for: the named one when known, else the offset. */
export function zoneFromQuery(req: Request): PlayStatsZone {
  const offset = typeof req.query.tz === "string" ? Number.parseInt(req.query.tz, 10) : 0;
  const named = req.query.timeZone;
  return typeof named === "string" && isValidTimeZone(named) ? named : offset;
}
