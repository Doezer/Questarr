import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

// Configure pino: JSON in production, human-readable format in development
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Create child loggers for different modules
export const igdbLogger = logger.child({ module: "igdb" });
export const routesLogger = logger.child({ module: "routes" });
export const expressLogger = logger.child({ module: "express" });
export const downloadersLogger = logger.child({ module: "downloaders" });
export const torznabLogger = logger.child({ module: "torznab" });
