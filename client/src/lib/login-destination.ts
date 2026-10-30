/** Only accept local router paths as post-login destinations. */
export function loginDestination(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  try {
    const base = "https://questarr.invalid";
    const url = new URL(next, base);
    if (url.origin !== base || ["/login", "/setup"].includes(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
