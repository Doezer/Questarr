// Drops explicitly-`undefined` keys from a partial update object before spreading it over an
// existing record, so a caller passing `{ field: undefined }` leaves that field untouched
// instead of typing (and, without this, actually nulling out) a required column. The return
// type strips `| undefined` from every property since none can be present-but-undefined anymore.
// Unwraps the single row from a Drizzle `.returning()` call after an insert/update that is
// expected to always affect exactly one row. Throwing here (rather than trusting the array
// isn't empty) turns a silently-wrong write into a loud failure instead of returning `undefined`
// through a type that promises a real record.
export function firstOrThrow<T>(rows: T[], message = "Expected write to return a row"): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(message);
  }
  return row;
}

export function stripUndefined<T extends object>(
  obj: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
