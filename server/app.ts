import express from "express";
import cors from "cors";
import { generalApiLimiter } from "./middleware.js";
import { config } from "./config.js";
import { expressLogger } from "./logger.js";
import { truncateLogData } from "./log-response.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

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

  app.use("/api", generalApiLimiter);

  app.use((_req, res, next) => {
    res.setHeader("Origin-Agent-Cluster", "?1");
    // Questarr instances are personal/self-hosted and should never be indexed
    // by search engines, even if exposed to the public internet.
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    next();
  });

  // Explicit robots.txt so well-behaved crawlers stay out even before
  // fetching any other page (belt-and-suspenders alongside X-Robots-Tag).
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: unknown;

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

        expressLogger.info(
          {
            method: req.method,
            path,
            statusCode: res.statusCode,
            duration,
            response: isNoisyEndpoint ? undefined : truncateLogData(capturedJsonResponse),
          },
          `${req.method} ${path} ${res.statusCode} in ${duration}ms`
        );

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

  return app;
}
