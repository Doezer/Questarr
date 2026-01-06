import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotificationItem } from "./NotificationItem";
import { Notification, Game } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { io } from "socket.io-client";
import { useToast } from "@/hooks/use-toast";

import GameDownloadDialog from "./GameDownloadDialog";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    // Refetch more often or rely on socket
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });

  // Fetch all games to map notifications to games
  const { data: games = [] } = useQuery<Game[]>({
    queryKey: ["/api/games"],
  });

  useEffect(() => {
    if (unreadCountData) {
      setUnreadCount(unreadCountData.count);
    }
  }, [unreadCountData]);

  // Socket.IO connection
  useEffect(() => {
    const socket = io();

    socket.on("connect", () => {
      // WebSocket connected
    });

    socket.on("notification", (notification: Notification) => {
      // Show toast
      toast({
        title: notification.title,
        description: notification.message,
        variant: notification.type === "error" ? "destructive" : "default",
      });

      // Update query cache
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient, toast]);

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PUT", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/notifications/read-all");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/notifications");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      markAsReadMutation.mutate(notification.id);
    }

    // Check if notification is about multiple results or updates
    if (
      notification.title === "Multiple Results Found" ||
      notification.title === "Multiple Releases Found" ||
      notification.title === "Game Updates Available"
    ) {
      // Try to find the game mentioned in the notification
      // This is a bit heuristic since we don't store gameId in notification directly yet
      // Ideally we should add gameId to notification schema, but for now we parse the message

      // Message format: "X result(s) found for [Game Title]. Please review..."
      // or "X update(s) found for [Game Title]"

      const gameTitleMatch = notification.message.match(/for (.+?)(\.|$)/);
      if (gameTitleMatch && gameTitleMatch[1]) {
        const gameTitle = gameTitleMatch[1].trim();
        const game = games.find((g) => g.title === gameTitle);

        if (game) {
          setSelectedGame(game);
          setDownloadDialogOpen(true);
          setOpen(false); // Close popover
        }
      }
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-600 animate-pulse" />
            )}
            <span className="sr-only">Notifications</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="flex items-center justify-between p-4 border-b">
            <h4 className="font-semibold leading-none">Notifications</h4>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Mark all as read"
                aria-label="Mark all notifications as read"
                onClick={() => markAllAsReadMutation.mutate()}
                disabled={unreadCount === 0}
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                title="Clear all"
                aria-label="Clear all notifications"
                onClick={() => clearAllMutation.mutate()}
                disabled={notifications.length === 0}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="h-[300px]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <Bell className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onRead={(id) => markAsReadMutation.mutate(id)}
                    onClick={() => handleNotificationClick(notification)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <GameDownloadDialog
        game={selectedGame}
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
      />
    </>
  );
}
