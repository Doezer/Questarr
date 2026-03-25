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
  LogOut,
  User,
  Newspaper,
  Rss,
  PieChart,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
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
import { useAuth } from "@/lib/auth";
import { GitHubVersionLink } from "@/components/GitHubVersionLink";

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
  {
    title: "xREL.to Releases",
    url: "/xrel",
    icon: Newspaper,
  },
  {
    title: "RSS Feeds",
    url: "/rss",
    icon: Rss,
  },
  {
    title: "Stats",
    url: "/stats",
    icon: PieChart,
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

export default function AppSidebar({ activeItem = "/", onNavigate }: Readonly<AppSidebarProps>) {
  const { logout, user } = useAuth();

  const handleNavigation = (url: string) => {
    onNavigate?.(url);
  };

  const { data: games = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: downloadsData } = useQuery<{ downloads: DownloadStatus[] }>({
    queryKey: ["/api/downloads"],
    refetchInterval: 5000,
  });

  const libraryCount = games.filter((g) =>
    ["owned", "completed", "downloading"].includes(g.status)
  ).length;
  const wishlistCount = games.filter((g) => g.status === "wanted").length;
  const activeDownloadsCount = downloadsData?.downloads?.length || 0;

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
                      aria-label={
                        item.badge
                          ? `${item.title}, ${item.badge} ${
                              item.title === "Downloads" ? "active downloads" : "items"
                            }`
                          : undefined
                      }
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
        <div className="flex-1" />
        {/* Divider above GitHub link */}
        <div className="border-t border-[#374151]/40 mx-2 mb-2" />
        {/* GitHub link and version info at the bottom */}
        <div className="flex items-center justify-center pb-2">
          <GitHubVersionLink />
        </div>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => logout()}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer w-full"
              tooltip="Log out"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <User className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user?.username || "User"}</span>
                <span className="truncate text-xs">Logged in</span>
              </div>
              <LogOut className="ml-auto size-4" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
