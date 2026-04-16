import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Subscribes to real-time log lines emitted by the server over Socket.io.
 * Calls `onLine` for each raw NDJSON string received.
 * Manages connection lifecycle (connect on mount, disconnect on unmount).
 */
export function useLogStream(onLine: (line: string) => void): void {
  // Stable ref so the effect doesn't re-run when onLine identity changes
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;

  useEffect(() => {
    const socket: Socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    const handler = (line: string) => onLineRef.current(line);
    socket.on("logLine", handler);

    return () => {
      socket.off("logLine", handler);
      socket.disconnect();
    };
  }, []);
}
