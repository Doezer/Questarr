import { ChevronRight, LogOut, User } from "lucide-react";
import { useMemo } from "react";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { type Game, type DownloadStatus } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { GitHubVersionLink } from "@/components/GitHubVersionLink";
import {
  activityNavigation,
  managementNavigation,
  primaryNavigation,
  type AppNavItem,
} from "@/components/navigation-items";
import { withBasePath } from "@/lib/app-path";

interface AppSidebarProps {
  activeItem?: string;
  onNavigate?: (url: string) => void;
}

// Stable reference for useQuery's no-data fallback so `games` doesn't change
// identity on every render (which would otherwise defeat wishlistCount's memo).
const EMPTY_GAMES: Game[] = [];

export default function AppSidebar({ activeItem = "/", onNavigate }: Readonly<AppSidebarProps>) {
  const { logout, user } = useAuth();

  const handleNavigation = (url: string) => {
    onNavigate?.(url);
  };

  const { data: games = EMPTY_GAMES } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  const { data: downloadsData } = useQuery<{ downloads: DownloadStatus[] }>({
    queryKey: ["/api/downloads"],
    refetchInterval: 30_000,
  });

  // ⚡ Single-pass counts instead of `.filter(...).length`, which walks the array
  // once and allocates an intermediate array that's immediately discarded.
  // Memoized so heavily re-rendered components like this sidebar don't recompute
  // on every render.
  const wishlistCount = useMemo(() => {
    let count = 0;
    for (const game of games) {
      if (game.status === "wanted") count++;
    }
    return count;
  }, [games]);

  const activeDownloadsCount = useMemo(() => {
    const downloads = downloadsData?.downloads;
    if (!downloads) return 0;
    let count = 0;
    for (const download of downloads) {
      if (download.status === "downloading") count++;
    }
    return count;
  }, [downloadsData?.downloads]);

  type NavItemWithBadge = Omit<AppNavItem, "children"> & {
    badge?: string | undefined;
    children?: NavItemWithBadge[] | undefined;
  };

  const withBadge = (item: AppNavItem): NavItemWithBadge => {
    let badge: string | undefined;
    if (item.title === "Wishlist" && wishlistCount > 0) {
      badge = wishlistCount.toString();
    } else if (item.title === "Downloads" && activeDownloadsCount > 0) {
      badge = activeDownloadsCount.toString();
    }
    return { ...item, badge, children: item.children?.map(withBadge) };
  };

  const navigation = primaryNavigation.map(withBadge);

  return (
    <Sidebar data-testid="sidebar-main">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center">
            <img src={withBasePath("/Questarr.svg")} alt="Questarr Logo" className="w-8 h-8" />
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
              {navigation.map((item) =>
                item.children && item.children.length > 0 ? (
                  <Collapsible key={item.title} defaultOpen className="group/collapsible" asChild>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          isActive={
                            activeItem === item.url ||
                            item.children.some((child) => child.url === activeItem)
                          }
                          data-testid={`nav-${item.title.toLowerCase()}`}
                        >
                          <item.icon className="w-4 h-4" aria-hidden="true" />
                          <span>{item.title}</span>
                          <ChevronRight
                            className="ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-90"
                            aria-hidden="true"
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.title}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={activeItem === child.url}
                                data-testid={`nav-${child.title.toLowerCase()}`}
                              >
                                <button
                                  onClick={() => handleNavigation(child.url)}
                                  className="flex items-center justify-between w-full"
                                  aria-label={
                                    child.badge ? `${child.title}, ${child.badge} items` : undefined
                                  }
                                >
                                  <div className="flex items-center gap-2">
                                    <child.icon className="w-4 h-4" aria-hidden="true" />
                                    <span>{child.title}</span>
                                  </div>
                                  {child.badge && (
                                    <Badge
                                      variant="secondary"
                                      className="ml-auto text-xs"
                                      aria-hidden="true"
                                    >
                                      {child.badge}
                                    </Badge>
                                  )}
                                </button>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
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
                          <item.icon className="w-4 h-4" aria-hidden="true" />
                          <span>{item.title}</span>
                        </div>
                        {item.badge && (
                          <Badge variant="secondary" className="ml-auto text-xs" aria-hidden="true">
                            {item.badge}
                          </Badge>
                        )}
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {managementNavigation.map((item) => (
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
                      <item.icon className="w-4 h-4" aria-hidden="true" />
                      <span>{item.title}</span>
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Activity</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {activityNavigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={activeItem === item.url}
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <button
                      onClick={() => handleNavigation(item.url)}
                      className="flex items-center gap-2 w-full"
                    >
                      <item.icon className="w-4 h-4" aria-hidden="true" />
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
