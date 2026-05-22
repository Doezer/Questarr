import {
  Calendar,
  Compass,
  Database,
  Download,
  HardDrive,
  Home,
  Newspaper,
  PieChart,
  Rss,
  ScrollText,
  Settings,
  Star,
} from "lucide-react";
import type { ComponentType } from "react";

type LucideIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export interface AppNavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}

export const primaryNavigation: AppNavItem[] = [
  { title: "Library", url: "/", icon: Home },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Calendar", url: "/calendar", icon: Calendar },
  { title: "Wishlist", url: "/wishlist", icon: Star },
  { title: "xREL.to Releases", url: "/xrel", icon: Newspaper },
  { title: "RSS Feeds", url: "/rss", icon: Rss },
  { title: "Stats", url: "/stats", icon: PieChart },
];

export const managementNavigation: AppNavItem[] = [
  { title: "Indexers", url: "/indexers", icon: Database },
  { title: "Downloaders", url: "/downloaders", icon: HardDrive },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Logs", url: "/logs", icon: ScrollText },
];

export const mobileBottomNavigation: AppNavItem[] = [
  { title: "Library", url: "/", icon: Home },
  { title: "Discover", url: "/discover", icon: Compass },
  { title: "Downloads", url: "/downloads", icon: Download },
  { title: "Wishlist", url: "/wishlist", icon: Star },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function getPageTitle(path: string): string {
  const item = [...primaryNavigation, ...managementNavigation].find((entry) => entry.url === path);
  return item?.title ?? "Questarr";
}
