// Force restart trigger
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { generalApiLimiter } from "./middleware.js";
import { config } from "./config.js";
import { expressLogger } from "./logger.js";
import { startCronJobs } from "./cron.js";
import { setupSocketIO } from "./socket.js";
import { ensureDatabase } from "./migrate.js";
import { rssService } from "./rss.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Apply general rate limiting to all API routes
app.use("/api", generalApiLimiter);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const isNoisyEndpoint =
        ((path === "/api/downloads" ||
          path === "/api/games" ||
          path === "/api/notifications" ||
          path === "/api/search" ||
          path === "/api/rss/items") &&
          req.method === "GET") ||
        path.startsWith("/api/igdb/genre/") ||
        path === "/api/igdb/popular" ||
        path === "/api/igdb/upcoming" ||
        path.match(/^\/api\/indexers\/[^/]+\/categories$/);

      // Helper to truncate log data
      const truncateLogData = (data: any, depth = 0): any => {
        if (!data) return data;
        if (depth > 2) return "[Object/Array]"; // Aggressive depth limit

        if (Array.isArray(data)) {
          if (data.length > 3) {
            // Truncate array items with increased depth
            const truncatedItems = data.slice(0, 3).map((item) => truncateLogData(item, depth + 1));
            return [...truncatedItems, `... ${data.length - 3} more items`];
          }
          return data.map((item) => truncateLogData(item, depth + 1));
        }

        if (typeof data === "object") {
          const newObj: any = {};
          const keys = Object.keys(data);

          // Limit number of keys shown per object to reduce verbosity
          const maxKeys = 5;
          const processingKeys = keys.slice(0, maxKeys);

          for (const key of processingKeys) {
            newObj[key] = truncateLogData(data[key], depth + 1);
          }

          if (keys.length > maxKeys) {
            newObj["_truncated"] = `... ${keys.length - maxKeys} more keys`;
          }
          return newObj;
        }

        if (typeof data === "string" && data.length > 50) {
          return data.substring(0, 50) + "...";
        }
        return data;
      };

      // Always log metadata at info level
      expressLogger.info(
        {
          method: req.method,
          path,
          statusCode: res.statusCode,
          duration,
          // Only include response body for non-noisy endpoints at info level, but truncated
          response: isNoisyEndpoint ? undefined : truncateLogData(capturedJsonResponse),
        },
        `${req.method} ${path} ${res.statusCode} in ${duration}ms`
      );

      // Log the full response body at debug level for noisy endpoints
      if (isNoisyEndpoint) {
        expressLogger.debug(
          {
            method: req.method,
            path,
            response: capturedJsonResponse,
          },
          `${req.method} ${path} response body`
        );
      }
    }
  });

  next();
});

(async () => {
  try {
    // Ensure database is ready before starting server
    await ensureDatabase();

    // Initialize RSS service (seeding default feeds)
    await rssService.initialize();

    const server = await registerRoutes(app);

    setupSocketIO(server);

    // Error handler must handle various error shapes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const error = err.message || "Internal Server Error";

      // Include details if available (e.g., validation errors)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: { error: string; details?: any } = { error };
      if (err.details) {
        response.details = err.details;
      }

      res.status(status).json(response);
      throw err;
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    const { port, host } = config.server;
    server.listen(port, host, () => {
      log(`serving on ${host}:${port}`);
      startCronJobs();
    });
  } catch (error) {
    log("Fatal error during startup:");
    console.error(error);
    process.exit(1);
  }
})();
