/** Uses the same HTTP fallback for scheme-less Prowlarr connection URLs. */
export function normalizeProwlarrUrl(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  const base = url.slice(0, end);
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
