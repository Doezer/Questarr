import pino from "pino";

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

// Helper to parse stack trace (extracts caller)
function getCallerInfo() {
  const stack = new Error().stack;
  if (!stack) return {};

  // Parse stack lines
  const lines = stack.split("\n");

  // Find the first line that is NOT from pino or this file
  // Typically:
  // 0: Error
  // 1: at getCallerInfo ...
  // 2: at pino mixin ...
  // We need to skip internal frames

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    // normalized check for node_modules and logger.ts
    if (!line.includes("node_modules") && !line.includes("logger.ts")) {
      // Basic extraction - this can be refined based on stack format
      const match = line.match(/at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?/);
      if (match) {
        // Clean up path - show relative to project root if possible
        let filePath = match[2];
        const cwd = process.cwd();
        if (filePath.startsWith(cwd)) {
          filePath = filePath.substring(cwd.length + 1);
        }

        return {
          logSource: `${filePath}:${match[3]} (${match[1] || "<anonymous>"})`,
        };
      }
    }
  }
  return {};
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin: () => {
      return getCallerInfo();
    },
  },
  transport
);

// Create child loggers for different modules
export const igdbLogger = logger.child({ module: "igdb" });
export const routesLogger = logger.child({ module: "routes" });
export const expressLogger = logger.child({ module: "express" });
export const downloadersLogger = logger.child({ module: "downloaders" });
export const torznabLogger = logger.child({ module: "torznab" });
export const searchLogger = logger.child({ module: "search" });
