// Drops explicitly-`undefined` keys from a partial update object before spreading it over an
// existing record, so a caller passing `{ field: undefined }` leaves that field untouched
// instead of typing (and, without this, actually nulling out) a required column. The return
// type strips `| undefined` from every property since none can be present-but-undefined anymore.
export function stripUndefined<T extends object>(
  obj: T
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
