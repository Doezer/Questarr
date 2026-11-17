/** A settings section: one page under /settings, one entry in the sidebar. */
export interface SettingsPageDef {
  /** Key of the section's content in the settings page (kept from the old tab ids). */
  id: string;
  /** Last segment of the URL: /settings/<slug>. */
  slug: string;
  title: string;
  description: string;
}

// [id, slug, title, description]
const PAGE_ROWS: readonly (readonly [string, string, string, string])[] = [
  [
    "appearance",
    "general",
    "General",
    "Theme, content filters, library filters, platforms and tags",
  ],
  [
    "discovery",
    "search-downloads",
    "Search & Downloads",
    "Auto-search, auto-download rules and the release name blacklist",
  ],
  [
    "scoring",
    "release-scoring",
    "Release Scoring",
    "How releases are scored, classified and reviewed",
  ],
  [
    "notifications",
    "notifications",
    "Notifications",
    "Apprise, Discord, webhooks and what you get notified about",
  ],
  [
    "integrations",
    "connections",
    "Connections",
    "IGDB, Steam, NexusMods, API keys and other services",
  ],
  ["import", "import", "Import", "Library imports, path mappings and import history"],
  [
    "account-security",
    "security",
    "Security",
    "Password, two-factor authentication and security scanning",
  ],
  ["system", "system", "System", "SSL, telemetry, backups and maintenance"],
];

export const SETTINGS_PAGES: readonly SettingsPageDef[] = PAGE_ROWS.map(
  ([id, slug, title, description]) => ({ id, slug, title, description })
);

/** Cards that moved to another section: older links (stored notifications) still name the old one. */
const MOVED_CARD_SLUGS = new Map([["classification-review", "release-scoring"]]);

export function settingsPagePath(slug: string): string {
  return `/settings/${slug}`;
}

/** The section named by a path such as /settings/connections, or undefined. */
export function settingsPageFromPath(path: string): SettingsPageDef | undefined {
  const slug = /^\/settings\/([^/?#]+)\/?$/.exec(path)?.[1];
  return SETTINGS_PAGES.find((page) => page.slug === slug);
}

/**
 * The section an older link points at: `?tab=<old tab id>` on /settings, or a card that moved
 * (`#classification-review`), whichever tab the link named. Null when the URL names none.
 */
export function legacySettingsSlug(search: string, hash: string): string | null {
  const moved = MOVED_CARD_SLUGS.get(hash.replace(/^#/, ""));
  if (moved) return moved;
  const tab = new URLSearchParams(search).get("tab");
  return SETTINGS_PAGES.find((page) => page.id === tab)?.slug ?? null;
}
