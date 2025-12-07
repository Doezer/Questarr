import { 
  Home, 
  Search, 
  Library, 
  Download, 
  Calendar, 
  Settings, 
  TrendingUp,
  Star,
  Database,
  HardDrive,
  Compass
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

const navigation = [
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
    badge: "48",
  },
  {
    title: "Downloads",
    url: "/downloads",
    icon: Download,
    badge: "3",
  },
  {
    title: "Calendar",
    url: "/calendar",
    icon: Calendar,
  },
  {
    title: "Trending",
    url: "/trending",
    icon: TrendingUp,
  },
  {
    title: "Wishlist",
    url: "/wishlist",
    icon: Star,
    badge: "12",
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
    console.log(`Navigation triggered: ${url}`);
    onNavigate?.(url);
  };

  return (
    <Sidebar data-testid="sidebar-main">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
            <Library className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg" data-testid="text-app-name">GameRadarr</h1>
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