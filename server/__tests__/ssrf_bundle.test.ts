import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerRoutes } from "../routes.js";

// Mock dependencies
vi.mock("../db", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    countUsers: vi.fn(),
    getUserGames: vi.fn().mockResolvedValue([]),
    getAllIndexers: vi.fn().mockResolvedValue([]),
    getEnabledIndexers: vi.fn().mockResolvedValue([]),
    getAllDownloaders: vi.fn().mockResolvedValue([]),
    getEnabledDownloaders: vi.fn().mockResolvedValue([]),
    getNotifications: vi.fn().mockResolvedValue([]),
    getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
    getUserSettings: vi.fn().mockResolvedValue({}),
    createUserSettings: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../auth", () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = { id: 1, username: "test" };
    next();
  },
  hashPassword: vi.fn(),
  comparePassword: vi.fn(),
  generateToken: vi.fn(),
}));

vi.mock("../igdb", () => ({
  igdbClient: {
    getPopularGames: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../logger", () => ({
  routesLogger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../torznab", () => ({
  torznabClient: {},
}));

vi.mock("../prowlarr", () => ({
  prowlarrClient: {},
}));

vi.mock("../downloaders", () => ({
  DownloaderManager: {
    getFreeSpace: vi.fn().mockResolvedValue(1000),
    getAllDownloads: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../search", () => ({
  searchAllIndexers: vi.fn(),
}));

// Mock archiver
let resRef: any;
const mockArchive = {
  pipe: vi.fn((res) => {
    resRef = res;
  }),
  append: vi.fn(),
  finalize: vi.fn().mockImplementation(async () => {
    if (resRef && resRef.end) {
      resRef.end();
    }
  }),
  on: vi.fn(),
};
vi.mock("archiver", () => ({
  default: () => mockArchive,
}));

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("SSRF Vulnerability in /api/downloads/bundle", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should fetch from unsafe URL if not validated", async () => {
    const maliciousUrl = "http://169.254.169.254/latest/meta-data/";

    // Mock fetch to succeed (simulating data exfiltration or successful connection)
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("secret data"),
    });

    await request(app)
      .post("/api/downloads/bundle")
      .send({
        downloads: [
          {
            link: maliciousUrl,
            title: "malicious_file",
          },
        ],
      });

    // AFTER FIX: expect fetch NOT to be called with the malicious URL
    // This assertion confirms the vulnerability is fixed
    expect(fetchMock).not.toHaveBeenCalledWith(maliciousUrl);
  });
});
