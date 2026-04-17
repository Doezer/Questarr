import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Plus, Moon, Sun, HardDrive, AlertCircle, Loader2 } from "lucide-react";

function SteamIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.721L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.455 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.662 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}
import AddGameModal from "./AddGameModal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationCenter } from "./NotificationCenter";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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

  const steamSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/steam/wishlist/sync");
      return (await res.json()) as { success: boolean; addedCount?: number; message?: string };
    },
    onSuccess: (data) => {
      toast({
        title: "Steam Sync",
        description:
          data.addedCount != null
            ? `Synced ${data.addedCount} game(s) from your Steam Wishlist.`
            : data.message || "Sync completed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to connect to server",
        variant: "destructive",
      });
    },
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
          {/* Storage Info — hidden on small screens */}
          <div className="hidden sm:flex items-center gap-2 sm:gap-3">
            {isLoading && (
              <span className="text-xs text-muted-foreground animate-pulse">
                Checking storage...
              </span>
            )}
            {isError && <span className="text-xs text-destructive">Error</span>}
            {!isLoading && !isError && storageInfo.length === 0 && (
              <span className="text-xs text-muted-foreground opacity-50 hidden sm:inline">
                No downloaders
              </span>
            )}
            {!isLoading &&
              !isError &&
              storageInfo.map((info) => (
                <Tooltip key={info.downloaderId}>
                  <TooltipTrigger asChild>
                    <div
                      className="flex items-center gap-1 sm:gap-1.5 text-xs text-muted-foreground border rounded-full px-2 py-0.5 sm:px-2.5 sm:py-1 hover:bg-muted/50 transition-colors cursor-help"
                      tabIndex={0}
                      role="button"
                      aria-label={`Storage for ${info.downloaderName}: ${formatBytes(info.freeSpace)} available`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") e.currentTarget.click();
                      }}
                    >
                      <HardDrive className="w-3 sm:w-3.5 h-3 sm:h-3.5" />
                      <span className="font-medium">{formatBytes(info.freeSpace)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-center">
                      <p className="font-semibold">{info.downloaderName}</p>
                      <p className="text-xs text-muted-foreground">Free Disk Space</p>
                      {info.error && <p className="text-destructive text-xs mt-1">{info.error}</p>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
          </div>

          <div className="flex items-center gap-2">
            <AddGameModal>
              <Button variant="default" size="sm" data-testid="button-add-game" className="gap-2">
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add Game</span>
              </Button>
            </AddGameModal>

            {user?.steamId64 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                disabled={steamSyncMutation.isPending}
                onClick={() => steamSyncMutation.mutate()}
              >
                {steamSyncMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <SteamIcon className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Sync Steam</span>
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
