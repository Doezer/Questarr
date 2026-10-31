/** Resolve internal notification commands to navigable Questarr pages. */
export function notificationPath(link: string | null | undefined): string | null {
  if (!link) return null;
  if (link.startsWith("modal:game:")) {
    const id = link.slice("modal:game:".length);
    return id ? `/games/${encodeURIComponent(id)}` : null;
  }
  // Error reports currently require an in-app dialog; there is no deep-link route.
  if (!link.startsWith("/") || link.startsWith("//")) return null;
  return link;
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

export function notificationUrl(
  link: string | null | undefined,
  appUrl: string | undefined,
  basePath = ""
): string | null {
  const target = notificationPath(link);
  if (!target || !appUrl) return null;
  try {
    const base = new URL(appUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) return null;
    const prefix = trimTrailingSlashes(base.pathname) || trimTrailingSlashes(basePath);
    const result = new URL(`${prefix}${target}`, base.origin);
    // Reject backslashes and other URL syntax that could escape this instance.
    const insideBasePath =
      !prefix || result.pathname === prefix || result.pathname.startsWith(`${prefix}/`);
    return result.origin === base.origin && insideBasePath ? result.href : null;
  } catch {
    return null;
  }
}
