// Force restart trigger
import "dotenv/config";
import express from "express";
import https from "https";
import fs from "fs";
import cors from "cors";

import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { generalApiLimiter, errorHandler } from "./middleware.js";
import { config } from "./config.js";
import { expressLogger } from "./logger.js";
import { truncateLogData } from "./logging-utils.js";
import { startCronJobs } from "./cron.js";
import { setupSocketIO } from "./socket.js";
import { ensureDatabase } from "./migrate.js";
import { rssService } from "./rss.js";
import { nexusmodsClient } from "./nexusmods.js";
import { storage } from "./storage.js";

const app = express();
if (config.server.isProduction) {
  app.set("trust proxy", 1);
}
app.use(
  cors({
    origin: config.server.allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

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

    // Initialize NexusMods client from DB (env var already applied at module load)
    const dbNexusKey = await storage.getSystemConfig("nexusmods.apiKey");
    if (dbNexusKey && dbNexusKey.length > 0) {
      nexusmodsClient.configure(dbNexusKey);
      log("NexusMods API key loaded from database");
    }

    const server = await registerRoutes(app);

    setupSocketIO(server);

    // Error handler must handle various error shapes
    // 🛡️ Sentinel: Use standardized error handler to prevent info leaks
    app.use(errorHandler);

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
                // Validate hostname to prevent open redirect via a crafted Host header.
                // req.path is already Express-normalized (no host component).
                const rawHostname = req.hostname;
                const safeHostname = /^[a-zA-Z0-9.\-[\]]+$/.test(rawHostname)
                  ? rawHostname
                  : "localhost";
                return res.redirect(`https://${safeHostname}:${ssl.port}${req.path}`);
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
