import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Plus, Moon, Sun, HardDrive, AlertCircle, Gamepad2 } from "lucide-react";
import AddGameModal from "./AddGameModal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationCenter } from "./NotificationCenter";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Config } from "@shared/schema";

interface HeaderProps {
  title?: string;
}

interface StorageInfo {
  downloaderId: string;
  downloaderName: string;
  freeSpace: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function Header({ title = "Dashboard" }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();

  // Fetch storage info every 5 minutes
  const {
    data: storageInfo = [],
    isLoading,
    isError,
  } = useQuery<StorageInfo[]>({
    queryKey: ["/api/downloaders/storage"],
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch user to check for Steam ID
  const { data: user } = useQuery<{ id: string; username: string; steamId64?: string }>({
    queryKey: ["/api/auth/me"],
  });

  // Fetch config to check for IGDB status
  const { data: config } = useQuery<Config>({
    queryKey: ["/api/config"],
  });

  // Avoid hydration mismatch by only rendering theme-dependent UI after mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <div className="flex flex-col w-full z-10">
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

        <div className="flex items-center gap-4">
          {/* Storage Info */}
          <div className="flex items-center gap-2 sm:gap-3">
            {isLoading && (
              <span className="text-[10px] sm:text-xs text-muted-foreground animate-pulse">
                Checking storage...
              </span>
            )}
            {isError && <span className="text-[10px] sm:text-xs text-destructive">Error</span>}
            {!isLoading && !isError && storageInfo.length === 0 && (
              <span className="text-[10px] sm:text-xs text-muted-foreground opacity-50 hidden sm:inline">
                No downloaders
              </span>
            )}
            {!isLoading &&
              !isError &&
              storageInfo.map((info) => (
                <Tooltip key={info.downloaderId}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-center gap-1 sm:gap-1.5 text-[10px] sm:text-xs text-muted-foreground border rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 hover:bg-muted/50 transition-colors cursor-help"
                      tabIndex={0}
                      role="button"
                      aria-label={`Storage for ${info.downloaderName}: ${formatBytes(info.freeSpace)} available`}
                    >
                      <HardDrive className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                      <span className="font-medium">{formatBytes(info.freeSpace)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-center">
                      <p className="font-semibold">{info.downloaderName}</p>
                      <p className="text-[10px] text-muted-foreground">Free Disk Space</p>
                      {info.error && (
                        <p className="text-destructive text-[10px] mt-1">{info.error}</p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
          </div>

          <div className="flex items-center gap-2">
            <AddGameModal>
              <Button variant="default" size="sm" data-testid="button-add-game" className="gap-2">
                <Plus className="w-4 h-4" />
                Add Game
              </Button>
            </AddGameModal>

            {user?.steamId64 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 hidden sm:flex"
                onClick={async () => {
                  try {
                    const response = await fetch("/api/steam/wishlist/sync", {
                      method: "POST",
                      headers: {
                        "Authorization": `Bearer ${localStorage.getItem("token")}`
                      }
                    });
                    const data = await response.json();

                    if (response.ok && data.success) {
                      toast({
                        title: "Steam Sync",
                        description: data.message || "Sync started successfully",
                      });
                    } else {
                      toast({
                        title: "Sync Failed",
                        description: data.error || data.message || "Unknown error",
                        variant: "destructive"
                      });
                    }
                  } catch (e) {
                    console.error(e);
                    toast({
                      title: "Sync Error",
                      description: "Failed to connect to server",
                      variant: "destructive"
                    });
                  }
                }}
              >
                <Gamepad2 className="w-4 h-4" />
                Sync Steam
              </Button>
            )}

            <NotificationCenter />

            <Button
              variant="ghost"
              size="icon"
              onClick={handleThemeToggle}
              data-testid="button-theme-toggle"
              aria-label="Toggle theme"
            >
              {mounted &&
                (theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />)}
              {!mounted && <Sun className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </header>

      {/* Configuration Alert Banner */}
      {config && !config.igdb.configured && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0 border-b-1">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Configuration Required</AlertTitle>
          <AlertDescription className="flex items-center gap-2">
            IGDB credentials are required. The application will only function for existing games
            until configured.
            <Link href="/settings">
              <span className="underline font-bold cursor-pointer hover:text-white">
                Configure in Settings
              </span>
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
