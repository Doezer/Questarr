import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "http";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

const USER_A = { id: "11111111-1111-4111-8111-111111111111", username: "alice" };
const USER_B = { id: "22222222-2222-4222-8222-222222222222", username: "bob" };
const TOKENS: Record<string, typeof USER_A> = { "token-a": USER_A, "token-b": USER_B };

vi.mock("../auth.js", () => ({
  verifyAuthToken: vi.fn(async (token: string) => TOKENS[token]),
}));

const { setupSocketIO, getIO, notifyUser } = await import("../socket.js");
const { AUTH_COOKIE_NAME } = await import("../security.js");

let httpServer: HttpServer;
let port = 0;
const clients: ClientSocket[] = [];

async function startServer() {
  httpServer = createServer();
  setupSocketIO(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
  const address = httpServer.address();
  port = typeof address === "object" && address ? address.port : 0;
}

function connect(options: Record<string, unknown> = {}): Promise<ClientSocket> {
  const socket = ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    ...options,
  });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

/**
 * Records every arrival for `event`. Call this BEFORE emitting: a listener
 * attached after the emit has already been delivered would report a real leak
 * as "nothing received".
 */
function collector(socket: ClientSocket, event: string) {
  const seen: unknown[] = [];
  socket.on(event, (payload: unknown) => seen.push(payload));
  return {
    seen,
    async until(count: number, ms = 1500): Promise<void> {
      const deadline = Date.now() + ms;
      while (seen.length < count && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }
      if (seen.length < count)
        throw new Error(`only saw ${seen.length}/${count} "${event}" events`);
    },
  };
}

/** Resolve once the server registered `room`, so join() timing cannot make a test flaky. */
async function waitUntilRoomJoined(room: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (getIO().sockets.adapter.rooms.has(room)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`room "${room}" was never joined`);
}

/** Let any in-flight broadcast reach this client before asserting it stayed empty. */
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  if (httpServer) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("socket user scoping (#1081)", () => {
  it("delivers a user-scoped notification only to that user's socket", async () => {
    await startServer();
    const socketA = await connect({ auth: { token: "token-a" } });
    const socketB = await connect({ auth: { token: "token-b" } });
    await waitUntilRoomJoined(`user:${USER_A.id}`);
    await waitUntilRoomJoined(`user:${USER_B.id}`);

    const forA = collector(socketA, "notification");
    const forB = collector(socketB, "notification");

    notifyUser("notification", { title: "alice-only", userId: USER_A.id }, USER_A.id);

    await forA.until(1);
    await settle();
    expect(forB.seen).toEqual([]);
  });

  it("reaches every socket of the same user", async () => {
    await startServer();
    const firstTab = await connect({ auth: { token: "token-a" } });
    const secondTab = await connect({ auth: { token: "token-a" } });
    await waitUntilRoomJoined(`user:${USER_A.id}`);

    const forFirst = collector(firstTab, "notification");
    const forSecond = collector(secondTab, "notification");

    notifyUser("notification", { title: "both-tabs" }, USER_A.id);

    await forFirst.until(1);
    await forSecond.until(1);
  });

  it("accepts the identity from the httpOnly auth cookie, as a browser handshake does", async () => {
    await startServer();
    const socketA = await connect({ extraHeaders: { cookie: `${AUTH_COOKIE_NAME}=token-a` } });
    await waitUntilRoomJoined(`user:${USER_A.id}`);

    const forA = collector(socketA, "notification");
    notifyUser("notification", { title: "via-cookie" }, USER_A.id);

    await forA.until(1);
    expect((forA.seen[0] as { title: string }).title).toBe("via-cookie");
  });

  it("still broadcasts events that have no target user", async () => {
    await startServer();
    const socketA = await connect({ auth: { token: "token-a" } });
    const socketB = await connect({ auth: { token: "token-b" } });

    const forA = collector(socketA, "downloadUpdate");
    const forB = collector(socketB, "downloadUpdate");

    notifyUser("downloadUpdate", "game-123");

    await forA.until(1);
    await forB.until(1);
  });

  it("still broadcasts notifications whose owner is unknown", async () => {
    await startServer();
    const socketA = await connect({ auth: { token: "token-a" } });
    const socketB = await connect({ auth: { token: "token-b" } });

    const forA = collector(socketA, "notification");
    const forB = collector(socketB, "notification");

    notifyUser("notification", { title: "app-wide" }, null);

    await forA.until(1);
    await forB.until(1);
  });
});
