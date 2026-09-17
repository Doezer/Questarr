import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Logger Module", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalLogLevel !== undefined) {
      process.env.LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  it("should export logger and child loggers", async () => {
    const loggerModule = await import("../logger.js");

    expect(loggerModule.logger).toBeDefined();
    expect(loggerModule.igdbLogger).toBeDefined();
    expect(loggerModule.routesLogger).toBeDefined();
    expect(loggerModule.expressLogger).toBeDefined();
    expect(loggerModule.downloadersLogger).toBeDefined();
    expect(loggerModule.torznabLogger).toBeDefined();
  });

  it("should create child loggers with module property", async () => {
    const loggerModule = await import("../logger.js");

    // Check that child loggers have the module property set
    expect(loggerModule.igdbLogger.bindings()).toHaveProperty("module", "igdb");
    expect(loggerModule.routesLogger.bindings()).toHaveProperty("module", "routes");
    expect(loggerModule.expressLogger.bindings()).toHaveProperty("module", "express");
    expect(loggerModule.downloadersLogger.bindings()).toHaveProperty("module", "downloaders");
    expect(loggerModule.torznabLogger.bindings()).toHaveProperty("module", "torznab");
  });

  it("should respect LOG_LEVEL environment variable", async () => {
    process.env.LOG_LEVEL = "debug";

    const loggerModule = await import("../logger.js");

    expect(loggerModule.logger.level).toBe("debug");
  });

  it("should default to debug level when LOG_LEVEL is not set", async () => {
    delete process.env.LOG_LEVEL;

    const loggerModule = await import("../logger.js");

    expect(loggerModule.logger.level).toBe("debug");
  });

  it("should default to info level in production when LOG_LEVEL is not set", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.LOG_LEVEL;

    const loggerModule = await import("../logger.js");

    expect(loggerModule.logger.level).toBe("info");
  });

  it("should still let LOG_LEVEL override the production default", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOG_LEVEL = "warn";

    const loggerModule = await import("../logger.js");

    expect(loggerModule.logger.level).toBe("warn");
  });

  it("redacts secret-shaped fields from structured log objects before they hit the sink", async () => {
    const loggerModule = await import("../logger.js");
    const { logEmitter } = await import("../log-events.js");

    const line: string = await new Promise((resolve) => {
      logEmitter.once("line", (l: string) => resolve(l));
      loggerModule.logger.info(
        {
          apiKey: "super-secret-value",
          token: "abc123",
          nested: { password: "hunter2" },
          safe: "keep-me",
        },
        "redaction marker message"
      );
    });

    expect(line).not.toContain("super-secret-value");
    expect(line).not.toContain("hunter2");

    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      apiKey: "[redacted]",
      token: "[redacted]",
      nested: { password: "[redacted]" },
      safe: "keep-me",
    });
  });

  it("configures the pino-pretty stdout target outside of production", async () => {
    process.env.NODE_ENV = "development";

    const pinoModule = await import("pino");
    const transportSpy = vi.spyOn(pinoModule.default, "transport");

    await import("../logger.js");

    expect(transportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([expect.objectContaining({ target: "pino-pretty" })]),
      })
    );
  });

  it("configures the raw stdout file target when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";

    const pinoModule = await import("pino");
    const transportSpy = vi.spyOn(pinoModule.default, "transport");

    await import("../logger.js");

    expect(transportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([
          expect.objectContaining({
            target: "pino/file",
            options: expect.objectContaining({ destination: 1 }),
          }),
        ]),
      })
    );
  });
});
