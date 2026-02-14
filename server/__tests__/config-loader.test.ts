import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import yaml from "js-yaml";
import { ConfigLoader } from "../config-loader";

// Mock modules
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
    },
  },
}));

vi.mock("path", () => ({
  default: {
    join: vi.fn((...args) => args.join("/")),
    dirname: vi.fn((p) => p.split("/").slice(0, -1).join("/")),
    resolve: vi.fn((...args) => args.join("/")),
  },
}));

vi.mock("js-yaml", () => ({
  default: {
    load: vi.fn(),
    dump: vi.fn(),
  },
}));

// Mock process.cwd
const originalCwd = process.cwd;
const mockCwd = vi.fn(() => "/app");

describe("ConfigLoader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.cwd = mockCwd;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  describe("Constructor Path Logic", () => {
    it("should prioritize data/config.yaml if it exists", () => {
      // @ts-expect-error - mocking fs.existsSync for test
      fs.existsSync.mockImplementation((path: string) => {
        return path.endsWith("/data/config.yaml");
      });
      // @ts-expect-error - mocking fs.readFileSync for test
      fs.readFileSync.mockReturnValue("ssl: { enabled: true }");
      // @ts-expect-error - mocking yaml.load for test
      yaml.load.mockReturnValue({ ssl: { enabled: true } });

      const loader = new ConfigLoader();
      // Path join mock joins with / so we expect "/app/data"
      expect(loader.getConfigDir()).toBe("/app/data");
    });

    it("should fallback to config.yaml if data/config.yaml missing but root exists", () => {
      // @ts-expect-error - mocking fs.existsSync for test
      fs.existsSync.mockImplementation((path: string) => {
        return path.endsWith("/config.yaml") && !path.includes("/data/");
      });
      // @ts-expect-error - mocking fs.readFileSync for test
      fs.readFileSync.mockReturnValue("ssl: { enabled: true }");
      // @ts-expect-error - mocking yaml.load for test
      yaml.load.mockReturnValue({ ssl: { enabled: true } });

      const loader = new ConfigLoader();
      expect(loader.getConfigDir()).toBe("/app");
    });

    it("should default to data/config.yaml for new instances if neither exists", () => {
      // @ts-expect-error - mocking fs.existsSync for test
      fs.existsSync.mockReturnValue(false);
      // @ts-expect-error - mocking yaml.load for test
      yaml.load.mockReturnValue({});

      const loader = new ConfigLoader();
      expect(loader.getConfigDir()).toBe("/app/data");
    });
  });

  describe("Environment Variable Overrides", () => {
    it("should override SSL port from env var", () => {
      process.env.SSL_PORT = "1234";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("ssl: { port: 9898 }");
      vi.mocked(yaml.load).mockReturnValue({ ssl: { port: 9898 } });

      const loader = new ConfigLoader("/app/config.yaml");
      expect(loader.getSslConfig().port).toBe(1234);
    });

    it("should use env var SSL port for default config if file broken", () => {
      process.env.SSL_PORT = "5678";
      vi.mocked(fs.existsSync).mockReturnValue(true); // File exists
      vi.mocked(fs.readFileSync).mockReturnValue("invalid yaml");
      vi.mocked(yaml.load).mockReturnValue("invalid"); // Simulate bad load

      // Mock console.error to suppress output
      vi.spyOn(console, "error").mockImplementation(() => {});

      const loader = new ConfigLoader();
      expect(loader.getSslConfig().port).toBe(5678);
    });
  });
});
