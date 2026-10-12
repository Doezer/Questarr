/** Uses the same HTTP fallback for scheme-less Prowlarr connection URLs. */
export function normalizeProwlarrUrl(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  const base = url.slice(0, end);
  return base.startsWith("http") ? base : `http://${base}`;
}

/** Saved credentials may be reused only for the same parsed connection identity. */
export function isSameProwlarrUrl(saved: string | undefined, requested: string): boolean {
  if (!saved) return false;
  try {
    return (
      new URL(normalizeProwlarrUrl(saved)).href === new URL(normalizeProwlarrUrl(requested)).href
    );
  } catch {
    return false;
  }
}
