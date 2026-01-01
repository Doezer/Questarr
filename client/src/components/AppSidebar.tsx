import {
  Home,
  Library,
  Download,
  Calendar,
  Settings,
  Star,
  Database,
  HardDrive,
  Compass,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { type Game, type DownloadStatus } from "@shared/schema";

const staticNavigation = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Discover",
    url: "/discover",
    icon: Compass,
  },
  {
    title: "Library",
    url: "/library",
    icon: Library,
  },
  {
    title: "Downloads",
    url: "/downloads",
    icon: Download,
  },
  {
    title: "Calendar",
    url: "/calendar",
    icon: Calendar,
  },
  {
    title: "Wishlist",
    url: "/wishlist",
    icon: Star,
  },
];

const management = [
  {
    title: "Indexers",
    url: "/indexers",
    icon: Database,
  },
  {
    title: "Downloaders",
    url: "/downloaders",
    icon: HardDrive,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

interface AppSidebarProps {
  activeItem?: string;
  onNavigate?: (url: string) => void;
}

export default function AppSidebar({ activeItem = "/", onNavigate }: AppSidebarProps) {
  const handleNavigation = (url: string) => {
    console.warn(`Navigation triggered: ${url}`);
    onNavigate?.(url);
  };

  const { data: games = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: downloadsData } = useQuery<{ torrents: DownloadStatus[] }>({
    queryKey: ["/api/downloads"],
    refetchInterval: 5000,
  });

  const libraryCount = games.filter((g) =>
    ["owned", "completed", "downloading"].includes(g.status)
  ).length;
  const wishlistCount = games.filter((g) => g.status === "wanted").length;
  const activeDownloadsCount = downloadsData?.torrents?.length || 0;

  const navigation = staticNavigation.map((item) => {
    let badge: string | undefined;

    if (item.title === "Library" && libraryCount > 0) {
      badge = libraryCount.toString();
    } else if (item.title === "Wishlist" && wishlistCount > 0) {
      badge = wishlistCount.toString();
    } else if (item.title === "Downloads" && activeDownloadsCount > 0) {
      badge = activeDownloadsCount.toString();
    }

    return { ...item, badge };
  });

  return (
    <Sidebar data-testid="sidebar-main">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center">
            <img src="/Questarr.svg" alt="Questarr Logo" className="w-8 h-8" />
          </div>
          <div>
            <span className="truncate font-semibold">Questarr</span>
            <p className="text-xs text-muted-foreground">Game Management</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeItem === item.url}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <button
                      onClick={() => handleNavigation(item.url)}
                      className="flex items-center justify-between w-full"
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </div>
                      {item.badge && (
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {item.badge}
                        </Badge>
                      )}
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {management.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeItem === item.url}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <button
                      onClick={() => handleNavigation(item.url)}
                      className="flex items-center gap-2 w-full"
                    >
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
