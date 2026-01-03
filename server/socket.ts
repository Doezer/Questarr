import { Server } from "socket.io";
import { type Server as HttpServer } from "http";
import { expressLogger } from "./logger.js";

let io: Server | undefined;

export function setupSocketIO(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // Adjust this for production security
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    expressLogger.info({ socketId: socket.id }, "Client connected to WebSocket");

    socket.on("disconnect", () => {
      expressLogger.info({ socketId: socket.id }, "Client disconnected from WebSocket");
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.IO not initialized!");
  }
  return io;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function notifyUser(type: string, payload: any) {
  if (io) {
    io.emit(type, payload);
  }
}
