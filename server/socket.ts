import { Server } from "socket.io";
import { type Server as HttpServer } from "http";
import { expressLogger } from "./logger.js";
import { config } from "./config.js";
import { logEmitter } from "./log-events.js";
import { verifyAuthToken } from "./auth.js";
import { AUTH_COOKIE_NAME, parseCookies } from "./security.js";

let io: Server | undefined;

/** Room prefix that binds a socket to the authenticated user it belongs to. */
const USER_ROOM_PREFIX = "user:";

export function setupSocketIO(httpServer: HttpServer) {
  if (!io) {
    io = new Server({
      path: `${config.server.basePath}/socket.io/`,
      cors: {
        origin:
          config.server.allowedOrigins.length === 1 && config.server.allowedOrigins[0] === "*"
            ? "*"
            : config.server.allowedOrigins,
        methods: ["GET", "POST"],
      },
    });

    // Every event on this server (live logs, notifications, download and
    // import progress) belongs to a signed-in user, so the handshake has to
    // carry the same credential the REST API accepts: the httpOnly auth
    // cookie a browser sends automatically, or a bearer token for a session
    // still on the legacy localStorage flow.
    io.use(async (socket, next) => {
      const credential = getHandshakeCredential(socket.handshake);
      // The cookie is ambient: a page on another origin that shares this site
      // (another app on the same host, say) could open a WebSocket and have
      // the browser attach it. WebSockets skip CORS, so check Origin here, the
      // same rule csrfProtection applies to cookie-authenticated REST calls.
      if (credential?.source === "cookie" && !isTrustedOrigin(socket.handshake.headers)) {
        return next(new Error("Authentication required"));
      }
      const user = credential ? await verifyAuthToken(credential.token) : undefined;
      if (!user) {
        return next(new Error("Authentication required"));
      }
      socket.data.userId = user.id;
      // Join during the handshake rather than in the connection handler, so a
      // notification fired right after connect cannot miss the room.
      void socket.join(`${USER_ROOM_PREFIX}${user.id}`);
      return next();
    });

    io.on("connection", (socket) => {
      expressLogger.info({ socketId: socket.id }, "Client connected to WebSocket");

      socket.on("disconnect", () => {
        expressLogger.info({ socketId: socket.id }, "Client disconnected from WebSocket");
      });
    });

    logEmitter.on("line", (line: string) => {
      io!.emit("logLine", line);
    });
  }

  io.attach(httpServer);

  return io;
}

interface HandshakeLike {
  auth: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

function getHandshakeCredential(
  handshake: HandshakeLike
): { token: string; source: "cookie" | "bearer" } | undefined {
  const authToken = handshake.auth["token"];
  if (typeof authToken === "string" && authToken) {
    return { token: authToken, source: "bearer" };
  }

  const authHeader = handshake.headers["authorization"];
  if (typeof authHeader === "string") {
    const [scheme, ...rest] = authHeader.split(" ");
    const bearerToken = rest.join(" ");
    if (scheme?.toLowerCase() === "bearer" && bearerToken) {
      return { token: bearerToken, source: "bearer" };
    }
  }

  const cookieHeader = handshake.headers["cookie"];
  const cookieToken = parseCookies(typeof cookieHeader === "string" ? cookieHeader : undefined)[
    AUTH_COOKIE_NAME
  ];
  return cookieToken ? { token: cookieToken, source: "cookie" } : undefined;
}

/**
 * A handshake's Origin is trusted when it is this server itself or one of the
 * explicitly configured ALLOWED_ORIGINS / APP_URL. "This server" means the
 * Host header, or X-Forwarded-Host when a reverse proxy rewrote Host: a page
 * can't set either header on a WebSocket handshake, so neither can be forged
 * from another origin. Browsers always send Origin on WebSocket and
 * cross-origin requests, so a missing one means a non-browser client, which
 * can't be riding someone else's cookie.
 */
function isTrustedOrigin(headers: HandshakeLike["headers"]): boolean {
  const origin = headers["origin"];
  if (typeof origin !== "string" || !origin) {
    return true;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const forwardedHost = headers["x-forwarded-host"];
  const selfHosts = [
    headers["host"],
    ...(typeof forwardedHost === "string" ? forwardedHost.split(",") : []),
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
  if (selfHosts.includes(originHost)) {
    return true;
  }
  const configured = [...config.server.allowedOrigins, config.server.appUrl].filter(
    (value): value is string => !!value && value !== "*"
  );
  return configured.some((allowed) => {
    try {
      return new URL(allowed).origin === new URL(origin).origin;
    } catch {
      return false;
    }
  });
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.IO not initialized!");
  }
  return io;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function notifyUser(type: string, payload: any, userId?: string | null) {
  if (!io) {
    return;
  }

  if (userId) {
    // Owner known: reach only that user's sockets.
    io.to(`${USER_ROOM_PREFIX}${userId}`).emit(type, payload);
    return;
  }

  // No owner (app-wide event): broadcast, as before.
  io.emit(type, payload);
}
