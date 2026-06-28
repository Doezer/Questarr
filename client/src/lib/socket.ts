import { io, type Socket } from "socket.io-client";
import { getSocketPath } from "@/lib/app-path";

let sharedSocket: Socket | null = null;

export function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io({
      path: getSocketPath(),
    });
  }

  return sharedSocket;
}
