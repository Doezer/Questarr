// Force restart trigger
import "dotenv/config";
import https from "https";
import fs from "fs";

import { createApp } from "./app.js";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { errorHandler } from "./middleware.js";
import { config } from "./config.js";
import { startCronJobs } from "./cron.js";
import { setupSocketIO } from "./socket.js";
import { ensureDatabase } from "./migrate.js";
import { rssService } from "./rss.js";
import { nexusmodsClient } from "./nexusmods.js";
import { appriseClient, readAppriseSettings } from "./apprise.js";
import { storage } from "./storage.js";

const app = createApp();

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

    // Initialize Apprise client from DB config
    const appriseSettings = await readAppriseSettings(storage);
    appriseClient.configure(appriseSettings);
    if (appriseClient.isConfigured()) {
      log(`Apprise client configured from database (${appriseSettings.mode} mode)`);
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
