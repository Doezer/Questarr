import { useMemo } from "react";

/** The viewer's clock for the stats routes: its UTC offset, IANA name and the query string. */
export function useViewerZone(): { tz: number; timeZone: string; search: string } {
  const tz = useMemo(() => new Date().getTimezoneOffset(), []);
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }, []);
  const search = useMemo(() => {
    const params = new URLSearchParams({ tz: String(tz) });
    if (timeZone) params.set("timeZone", timeZone);
    return params.toString();
  }, [tz, timeZone]);
  return { tz, timeZone, search };
}
