import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Plus, Bell, User, Moon, Sun } from "lucide-react";
import { useState } from "react";
import AddGameModal from "./AddGameModal";

interface HeaderProps {
  title?: string;
  onAddGame?: () => void;
  onToggleTheme?: () => void;
  isDarkMode?: boolean;
  notificationCount?: number;
}

export default function Header({ 
  title = "Dashboard", 
  onAddGame, 
  onToggleTheme,
  isDarkMode = true,
  notificationCount = 0
}: HeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false);

  const handleAddGame = () => {
    console.log("Add game triggered");
    onAddGame?.();
  };

  const handleThemeToggle = () => {
    console.log("Theme toggle triggered");
    onToggleTheme?.();
  };

  const handleNotificationClick = () => {
    console.log("Notifications triggered");
    setShowNotifications(!showNotifications);
  };

  const handleProfileClick = () => {
    console.log("Profile triggered");
  };

  return (
    <header className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <h1 className="text-xl font-semibold" data-testid="text-page-title">{title}</h1>
      </div>
      
      <div className="flex items-center gap-2">
        <AddGameModal>
          <Button
            variant="default"
            size="sm"
            data-testid="button-add-game"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Game
          </Button>
        </AddGameModal>
        
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNotificationClick}
            data-testid="button-notifications"
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
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleThemeToggle}
          data-testid="button-theme-toggle"
        >
          {isDarkMode ? (
            <Sun className="w-4 h-4" />
          ) : (
            <Moon className="w-4 h-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleProfileClick}
          data-testid="button-profile"
        >
          <User className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}