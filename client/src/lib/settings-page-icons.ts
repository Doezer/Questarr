import {
  Bell,
  Download,
  Monitor,
  Plug,
  Scale,
  Search,
  Server,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { ComponentType } from "react";

type SettingsPageIcon = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// Kept apart from settings-pages.ts so the route table doesn't pull the icon set into every
// module that only needs a path.
const ICONS: Record<string, SettingsPageIcon> = {
  general: Monitor,
  "search-downloads": Search,
  "release-scoring": Scale,
  notifications: Bell,
  connections: Plug,
  import: Download,
  security: ShieldCheck,
  system: Server,
};

export function settingsPageIcon(slug: string): SettingsPageIcon {
  return ICONS[slug] ?? Settings;
}
