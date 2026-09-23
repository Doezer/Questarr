import {
  Calendar,
  ClipboardList,
  Compass,
  Database,
  Download,
  Gamepad2,
  HardDrive,
  Home,
  Newspaper,
  PieChart,
  Rss,
  ScrollText,
  Search,
  Settings,
  Star,
} from "lucide-react";
import type { ComponentType } from "react";

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
    ],
  },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "xREL.to Releases", url: "/xrel", icon: Newspaper },
  { title: "RSS Feeds", url: "/rss", icon: Rss },
  { title: "Stats", url: "/stats", icon: PieChart },
];

export const managementNavigation: AppNavItem[] = [
  { title: "Indexers", url: "/indexers", icon: Database },
  { title: "Downloaders", url: "/downloaders", icon: HardDrive },
  { title: "Settings", url: "/settings", icon: Settings },
];

export const activityNavigation: AppNavItem[] = [
  { title: "Logs", url: "/logs", icon: ScrollText },
  { title: "Import History", url: "/activity/imports", icon: ClipboardList },
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
  ...managementNavigation,
  ...activityNavigation,
  { title: "Search", url: "/search", icon: Search },
];

export function getPageTitle(path: string): string {
  const item = allNavigation.find((entry) => entry.url === path);
  return item?.title ?? "Questarr";
}
