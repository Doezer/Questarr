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

// Configure pino with multiple targets
const transport = pino.transport({
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
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  pino.multistream([{ stream: transport }, { stream: new LogBroadcaster(), level: "trace" }])
);

// Create child loggers for different modules
export const igdbLogger = logger.child({ module: "igdb" });
export const routesLogger = logger.child({ module: "routes" });
export const expressLogger = logger.child({ module: "express" });
export const downloadersLogger = logger.child({ module: "downloaders" });
export const torznabLogger = logger.child({ module: "torznab" });
export const searchLogger = logger.child({ module: "search" });
