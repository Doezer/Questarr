import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Plus, Bell, Moon, Sun } from "lucide-react";
import { useState } from "react";
import AddGameModal from "./AddGameModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HeaderProps {
  title?: string;
  _onAddGame?: () => void;
  onToggleTheme?: () => void;
  isDarkMode?: boolean;
  notificationCount?: number;
}

export default function Header({
  title = "Dashboard",
  onToggleTheme,
  isDarkMode = true,
  notificationCount = 0,
}: HeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);

  const handleThemeToggle = () => {
    console.warn("Theme toggle triggered");
    onToggleTheme?.();
  };

  return (
    <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Toggle Sidebar</p>
          </TooltipContent>
        </Tooltip>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <AddGameModal>
          <Button variant="default" size="sm" data-testid="button-add-game" className="gap-2">
            <Plus className="w-4 h-4" />
            Add Game
          </Button>
        </AddGameModal>

        <Popover open={showNotifications} onOpenChange={setShowNotifications}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              data-testid="button-notifications"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {notificationCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 w-5 h-5 text-xs p-0 flex items-center justify-center"
                  data-testid="badge-notification-count"
                >
                  {notificationCount > 9 ? "9+" : notificationCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <div className="space-y-4">
              <h4 className="font-medium">Notifications</h4>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No new notifications</p>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleThemeToggle}
          data-testid="button-theme-toggle"
          aria-label="Toggle theme"
        >
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
}
