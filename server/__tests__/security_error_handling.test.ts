
import { describe, it, expect, vi } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
// We will implement this in the next step
import { errorHandler } from "../middleware.js";

// Mock logger to avoid actual logging during tests
vi.mock("../logger.js", () => ({
  expressLogger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock storage since middleware might import it
vi.mock("../storage.js", () => ({
  storage: {
    getUserSettings: vi.fn(),
  },
}));

describe("Security Error Handling", () => {
  it("should sanitize 500 errors in production", async () => {
    const app = express();
    app.set("env", "production");

    app.get("/error", (req, res, next) => {
      const err: any = new Error("Sensitive Database Info");
      err.status = 500;
      next(err);
    });

    app.use(errorHandler);

    const response = await request(app).get("/error");
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal Server Error");
    expect(response.body.error).not.toContain("Sensitive Database Info");
  });

  it("should show details in development", async () => {
    const app = express();
    app.set("env", "development");

    app.get("/error", (req, res, next) => {
      const err: any = new Error("Debug Info");
      err.status = 500;
      next(err);
    });

    app.use(errorHandler);

    const response = await request(app).get("/error");
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Debug Info");
  });

  it("should pass through client errors (4xx) unchanged", async () => {
    const app = express();
    // Environment shouldn't matter for 4xx
    app.set("env", "production");

    app.get("/error", (req, res, next) => {
      const err: any = new Error("Invalid Input");
      err.status = 400;
      next(err);
    });

    app.use(errorHandler);

    const response = await request(app).get("/error");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid Input");
  });

  it("should handle errors explicitly thrown without status", async () => {
     const app = express();
    app.set("env", "production");

    app.get("/error", (req, res, next) => {
      next(new Error("Unexpected Error"));
    });

    app.use(errorHandler);

    const response = await request(app).get("/error");
    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal Server Error");
  });
});
