import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic, log } from "./vite.js";
import { generalApiLimiter } from "./middleware.js";
import { config } from "./config.js";
import { expressLogger } from "./logger.js";

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
      expressLogger.info(
        {
          method: req.method,
          path,
          statusCode: res.statusCode,
          duration,
          response: capturedJsonResponse,
        },
        `${req.method} ${path} ${res.statusCode} in ${duration}ms`
      );
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

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

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const { port, host } = config.server;
  server.listen(port, host, () => {
    log(`serving on ${host}:${port}`);
  });
})();
