import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules to ensure fresh config import each time
    vi.resetModules();
    
    // Clear all environment variables used by config
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    delete process.env.IGDB_CLIENT_ID;
    delete process.env.IGDB_CLIENT_SECRET;
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('when DATABASE_URL is missing', () => {
    it('should call process.exit(1) and log error message', async () => {
      // Mock process.exit to prevent tests from exiting, but throw to stop execution
      const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with code ${code}`);
      });
      
      // Spy on console.error to verify error message
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Import the config module - this should trigger validation and throw
      await expect(import('../config.js')).rejects.toThrow('process.exit called with code 1');
      
      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid environment configuration'));
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('when PORT is invalid', () => {
    it('should call process.exit(1) for non-numeric PORT', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.PORT = 'invalid';
      
      // Mock process.exit to prevent tests from exiting, but throw to stop execution
      const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit called with code ${code}`);
      });
      
      // Spy on console.error to verify error message
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Import the config module - this should trigger validation and throw
      await expect(import('../config.js')).rejects.toThrow('process.exit called with code 1');
      
      expect(mockProcessExit).toHaveBeenCalledWith(1);
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('when DATABASE_URL is set', () => {
    it('should export valid config with defaults', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      
      const { config } = await import('../config.js');
      
      expect(config.database.url).toBe('postgresql://user:pass@localhost:5432/testdb');
      expect(config.server.port).toBe(5000); // default
      expect(config.server.host).toBe('localhost'); // default
      expect(config.server.nodeEnv).toBe('development'); // default
      expect(config.igdb.isConfigured).toBe(false);
    });

    it('should respect custom PORT and HOST', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.PORT = '3000';
      process.env.HOST = '0.0.0.0';
      
      const { config } = await import('../config.js');
      
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
    });

    it('should detect IGDB as configured when both credentials are set', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.IGDB_CLIENT_ID = 'test-client-id';
      process.env.IGDB_CLIENT_SECRET = 'test-client-secret';
      
      const { config } = await import('../config.js');
      
      expect(config.igdb.isConfigured).toBe(true);
      expect(config.igdb.clientId).toBe('test-client-id');
      expect(config.igdb.clientSecret).toBe('test-client-secret');
    });

    it('should detect IGDB as not configured when only one credential is set', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.IGDB_CLIENT_ID = 'test-client-id';
      // IGDB_CLIENT_SECRET is not set
      
      const { config } = await import('../config.js');
      
      expect(config.igdb.isConfigured).toBe(false);
      expect(config.igdb.clientId).toBe('test-client-id');
      expect(config.igdb.clientSecret).toBeUndefined();
    });

    it('should set NODE_ENV correctly', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'production';
      
      const { config } = await import('../config.js');
      
      expect(config.server.nodeEnv).toBe('production');
      expect(config.server.isProduction).toBe(true);
      expect(config.server.isDevelopment).toBe(false);
      expect(config.server.isTest).toBe(false);
    });

    it('should set test environment flags correctly', async () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/testdb';
      process.env.NODE_ENV = 'test';
      
      const { config } = await import('../config.js');
      
      expect(config.server.nodeEnv).toBe('test');
      expect(config.server.isTest).toBe(true);
      expect(config.server.isDevelopment).toBe(false);
      expect(config.server.isProduction).toBe(false);
    });
  });
});
