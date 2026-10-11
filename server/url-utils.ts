/** Uses the same HTTP fallback for scheme-less Prowlarr connection URLs. */
export function normalizeProwlarrUrl(url: string): string {
  const base = url.replace(/\/+$/, "");
  return base.startsWith("http") ? base : `http://${base}`;
}

export function extractHostnameFromUrl(url?: string | null): string | null {
  if (!url) return null;

  try {
    const normalizedUrl =
      url.startsWith("http://") || url.startsWith("https://") ? url : `http://${url}`;
    return new URL(normalizedUrl).hostname;
  } catch {
    return null;
  }
}
