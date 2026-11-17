import {
  Calendar,
  DatabaseBackup,
  ClipboardList,
  Ban,
  History,
  Timer,
  Compass,
  Database,
  Download,
  FolderInput,
  Gamepad2,
  HardDrive,
  Home,
  Layers,
  Newspaper,
  PieChart,
  Rss,
  ScrollText,
  Search,
  Settings,
  Star,
} from "lucide-react";
import type { ComponentType } from "react";
import { SETTINGS_PAGES, settingsPagePath } from "@/lib/settings-pages";
import { settingsPageIcon } from "@/lib/settings-page-icons";

type LucideIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export interface AppNavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Nested sub-items, rendered as a collapsible group under this entry (sidebar only). */
  children?: AppNavItem[] | undefined;
}

export const primaryNavigation: AppNavItem[] = [
  {
    title: "Library",
    url: "/",
    icon: Home,
    children: [
      { title: "All Games", url: "/", icon: Home },
      { title: "Wishlist", url: "/wishlist", icon: Star },
      { title: "Playing", url: "/playing", icon: Gamepad2 },
      { title: "Collections", url: "/collections", icon: Layers },
      { title: "Library Import", url: "/library-import", icon: FolderInput },
    ],
  },
  {
    title: "Discover",
    url: "/discover",
    icon: Compass,
    // The group header only toggles the group, so the Discover page itself needs its own
    // entry here (like "All Games" under Library), or the desktop sidebar can't reach it.
    children: [
      { title: "Browse", url: "/discover", icon: Compass },
      { title: "xREL.to Releases", url: "/xrel", icon: Newspaper },
      { title: "RSS Feeds", url: "/rss", icon: Rss },
    ],
  },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Stats", url: "/stats", icon: PieChart },
];

export const managementNavigation: AppNavItem[] = [
  { title: "Indexers", url: "/indexers", icon: Database },
  { title: "Downloaders", url: "/downloaders", icon: HardDrive },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
    // One page per section. The group header only toggles the group on desktop (/settings opens
    // the first section); on a phone /settings is the list of sections.
    children: SETTINGS_PAGES.map((page) => ({
      title: page.title,
      url: settingsPagePath(page.slug),
      icon: settingsPageIcon(page.slug),
    })),
  },
];

export const activityNavigation: AppNavItem[] = [
  { title: "Logs", url: "/logs", icon: ScrollText },
  { title: "History", url: "/activity/history", icon: History },
  { title: "Blocklist", url: "/activity/blocklist", icon: Ban },
  { title: "Import History", url: "/activity/imports", icon: ClipboardList },
  { title: "System Tasks", url: "/system/tasks", icon: Timer },
  { title: "Backups", url: "/system/backups", icon: DatabaseBackup },
];

export const mobileBottomNavigation: AppNavItem[] = [
  { title: "Library", url: "/", icon: Home },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Playing", url: "/playing", icon: Gamepad2 },
];

export function flattenNavigation(items: AppNavItem[]): AppNavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? flattenNavigation(item.children) : []),
  ]);
}

const allNavigation: AppNavItem[] = [
  ...flattenNavigation(primaryNavigation),
  ...flattenNavigation(managementNavigation),
  ...activityNavigation,
  { title: "Search", url: "/search", icon: Search },
];

export function getPageTitle(path: string): string {
  // Sections show their own title in the page; the header names the area.
  if (path === "/settings" || path.startsWith("/settings/")) return "Settings";
  const item = allNavigation.find((entry) => entry.url === path);
  return item?.title ?? "Questarr";
}
