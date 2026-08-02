import pino from "pino";
import { Writable } from "node:stream";
import { consumeLogChunk, flushLogRemainder } from "./log-stream.js";
import { logEmitter } from "./log-events.js";

class LogBroadcaster extends Writable {
  private remainder = "";

  constructor() {
    super({ objectMode: false, decodeStrings: false });
  }

  _write(chunk: string | Buffer, _encoding: string, callback: () => void): void {
    const { lines, remainder } = consumeLogChunk(chunk, this.remainder);
    this.remainder = remainder;
    for (const line of lines) {
      logEmitter.emit("line", line);
    }
    callback();
  }

  _final(callback: (error?: Error | null) => void): void {
    const line = flushLogRemainder(this.remainder);
    if (line) {
      logEmitter.emit("line", line);
    }
    this.remainder = "";
    callback();
  }
}

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

// Tests import this module in every server test file. The full transport pipeline below
// spawns worker threads per target (file + pino-pretty) and writes to a shared server.log,
// which across a full multi-file test run compounds into vitest's own worker/fork teardown
// and can overflow its IPC layer. Skip it in tests and broadcast in-process only.
const destination = isTest
  ? pino.multistream([{ stream: new LogBroadcaster(), level: "trace" }])
  : pino.multistream([
      {
        stream: pino.transport({
          targets: [
            {
              target: "pino/file",
              options: { destination: "./server.log", mkdir: true },
            },
            isProduction
              ? {
                  target: "pino/file",
                  options: { destination: 1 }, // stdout
                }
              : {
                  target: "pino-pretty",
                  options: {
                    colorize: true,
                    destination: 1, // stdout
                  },
                },
          ],
        }),
      },
      { stream: new LogBroadcaster(), level: "trace" },
    ]);

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  destination
);

// Create child loggers for different modules
export const igdbLogger = logger.child({ module: "igdb" });
export const routesLogger = logger.child({ module: "routes" });
export const expressLogger = logger.child({ module: "express" });
export const downloadersLogger = logger.child({ module: "downloaders" });
export const torznabLogger = logger.child({ module: "torznab" });
export const searchLogger = logger.child({ module: "search" });
