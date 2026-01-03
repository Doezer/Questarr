import { Notification } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { Check, Info, AlertTriangle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface NotificationItemProps {
  notification: Notification;
  onRead: (id: string) => void;
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const getIcon = () => {
    switch (notification.type) {
      case "success":
        return <Check className="h-4 w-4 text-green-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "delayed":
        return <Clock className="h-4 w-4 text-orange-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div
      className={cn(
        "flex gap-3 p-3 text-sm transition-colors hover:bg-muted/50 cursor-pointer relative group",
        !notification.read && "bg-muted/30 border-l-2 border-primary"
      )}
      onClick={() => !notification.read && onRead(notification.id)}
    >
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 space-y-1">
        <div className="flex justify-between items-start">
          <p className="font-medium leading-none">{notification.title}</p>
          {!notification.read && <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
        </div>
        <p className="text-muted-foreground">{notification.message}</p>
        <p className="text-xs text-muted-foreground pt-1">
          {notification.createdAt &&
            formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}
