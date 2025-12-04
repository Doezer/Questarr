import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Logger Module', () => {
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

  it('should export logger and child loggers', async () => {
    const loggerModule = await import('../logger.js');
    
    expect(loggerModule.logger).toBeDefined();
    expect(loggerModule.igdbLogger).toBeDefined();
    expect(loggerModule.routesLogger).toBeDefined();
    expect(loggerModule.expressLogger).toBeDefined();
    expect(loggerModule.downloadersLogger).toBeDefined();
    expect(loggerModule.torznabLogger).toBeDefined();
  });

  it('should create child loggers with module property', async () => {
    const loggerModule = await import('../logger.js');
    
    // Check that child loggers have the module property set
    expect(loggerModule.igdbLogger.bindings()).toHaveProperty('module', 'igdb');
    expect(loggerModule.routesLogger.bindings()).toHaveProperty('module', 'routes');
    expect(loggerModule.expressLogger.bindings()).toHaveProperty('module', 'express');
    expect(loggerModule.downloadersLogger.bindings()).toHaveProperty('module', 'downloaders');
    expect(loggerModule.torznabLogger.bindings()).toHaveProperty('module', 'torznab');
  });

  it('should respect LOG_LEVEL environment variable', async () => {
    process.env.LOG_LEVEL = 'debug';
    
    const loggerModule = await import('../logger.js');
    
    expect(loggerModule.logger.level).toBe('debug');
  });

  it('should default to info level when LOG_LEVEL is not set', async () => {
    delete process.env.LOG_LEVEL;
    
    const loggerModule = await import('../logger.js');
    
    expect(loggerModule.logger.level).toBe('info');
  });
});
