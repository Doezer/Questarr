// Force restart trigger
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import https from "https";
import fs from "fs";
import cors from "cors";
import crypto from "crypto";

import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { generalApiLimiter } from "./middleware.js";
import { config } from "./config.js";
import { expressLogger } from "./logger.js";
import { startCronJobs } from "./cron.js";
import { setupSocketIO } from "./socket.js";
import { ensureDatabase } from "./migrate.js";
import { rssService } from "./rss.js";
import session from "express-session";
import passport from "passport";
import { logger } from "./logger.js";

const app = express();
app.use(
  cors({
    origin: config.server.allowedOrigins,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Resolve a secure session secret. Prefer the environment variable; fall back
// to a randomly generated value so we never ship with a predictable default.
const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  logger.warn(
    "SESSION_SECRET is not set. A random secret has been generated for this process. " +
      "Sessions will be invalidated on restart. Set SESSION_SECRET in your .env file for persistence."
  );
  return generated;
})();

// Setup Session (Required for Passport)
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Apply general rate limiting to all API routes
app.use("/api", generalApiLimiter);

// 🛡️ Set Origin-Agent-Cluster header to preventing mismatch errors
app.use((_req, res, next) => {
  res.setHeader("Origin-Agent-Cluster", "?1");
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

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
      const truncateLogData = (data: unknown, depth = 0): unknown => {
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
          const dict = data as Record<string, unknown>;
          const newObj: Record<string, unknown> = {};
          const keys = Object.keys(dict);

          // Limit number of keys shown per object to reduce verbosity
          const maxKeys = 5;
          const processingKeys = keys.slice(0, maxKeys);

          for (const key of processingKeys) {
            newObj[key] = truncateLogData(dict[key], depth + 1);
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
    const { ssl } = config;

    // Start HTTP server
    server.listen(port, host, () => {
      log(`HTTP server serving on ${host}:${port}`);
    });

    // Start HTTPS server if enabled
    if (ssl.enabled && ssl.certPath && ssl.keyPath) {
      try {
        // Validate certs before attempting to start
        const { validateCertFiles } = await import("./ssl.js");
        const { valid, error } = await validateCertFiles(ssl.certPath, ssl.keyPath);

        if (!valid) {
          log(`⚠️ SSL Configuration Invalid: ${error}. Starting in HTTP-only mode.`);
          // Skip HTTPS setup
        } else {
          const httpsOptions = {
            key: await fs.promises.readFile(ssl.keyPath),
            cert: await fs.promises.readFile(ssl.certPath),
          };

          const httpsServer = https.createServer(httpsOptions, app);

          // Setup Socket.IO for HTTPS server as well
          setupSocketIO(httpsServer);

          httpsServer.listen(ssl.port, host, () => {
            log(`HTTPS server serving on ${host}:${ssl.port}`);
          });

          // HTTP to HTTPS redirect
          if (ssl.redirectHttp) {
            app.use((req, res, next) => {
              if (req.path === "/api/health") {
                return next();
              }
              if (!req.secure) {
                const host = req.hostname || "localhost";
                return res.redirect(`https://${host}:${ssl.port}${req.url}`);
              }
              next();
            });
          }
        }
      } catch (error) {
        log("Failed to start HTTPS server: " + String(error));
        // Fallback or just log error, HTTP server is already running
      }
    }

    // Log non-sensitive config
    log("Server initialized with configuration:");
    const safeConfig = { ...config };
    // Redact sensitive info
    if (safeConfig.auth) {
      safeConfig.auth = { ...safeConfig.auth, jwtSecret: "***REDACTED***" };
    }
    if (safeConfig.igdb) {
      safeConfig.igdb = {
        ...safeConfig.igdb,
        clientId: safeConfig.igdb.clientId ? "***REDACTED***" : undefined,
        clientSecret: safeConfig.igdb.clientSecret ? "***REDACTED***" : undefined,
      };
    }
    log(JSON.stringify(safeConfig, null, 2));

    if (ssl.enabled && ssl.redirectHttp) {
      log("⚠️ WARNING: HTTP to HTTPS redirection is ENABLED.");
      log(
        "⚠️ If you lose access, you can disable SSL by setting 'enabled: false' in your config.yaml or data/config.yaml file."
      );
    }

    startCronJobs();
  } catch (error) {
    log("Fatal error during startup:");
    console.error(error);
    process.exit(1);
  }
})();
