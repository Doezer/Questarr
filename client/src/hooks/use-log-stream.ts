import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";

/**
 * Subscribes to real-time log lines emitted by the server over Socket.io.
 * Calls `onLine` for each raw NDJSON string received.
 * Uses the shared socket.io singleton — does NOT disconnect on unmount,
 * which would tear down the app-wide connection used by NotificationCenter.
 */
export function useLogStream(onLine: (line: string) => void): void {
  // Stable ref so the effect doesn't re-run when onLine identity changes
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  useEffect(() => {
    const socket = getSocket();
    const handler = (line: string) => onLineRef.current(line);
    socket.on("logLine", handler);
    return () => {
      socket.off("logLine", handler);
    };
  }, []);
}
