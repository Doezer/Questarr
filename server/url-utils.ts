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
