import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockStorage, fsMock } = vi.hoisted(() => ({
  mockStorage: {
    getImportConfig: vi.fn(),
  },
  fsMock: {
    pathExists: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  },
}));

vi.mock("../storage.js", () => ({
  storage: mockStorage,
}));

vi.mock("fs-extra", () => ({
  default: fsMock,
}));

import { systemRouter } from "../routes/system.js";

describe("systemRouter /browse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getImportConfig.mockResolvedValue({ libraryRoot: "/data" });
  });

  function createApp(withUser = true) {
    const app = express();
    app.use((req, _res, next) => {
      if (withUser) {
        (req as express.Request & { user?: { id: string } }).user = { id: "u1" };
      }
      next();
    });
    app.use("/api/system", systemRouter);
    return app;
  }

  it("returns 401 when user is missing", async () => {
    const app = createApp(false);
    const response = await request(app).get("/api/system/browse?path=/data");
    expect(response.status).toBe(401);
  });

  it("rejects absolute host paths", async () => {
    const app = createApp();

    const winDrive = await request(app).get("/api/system/browse?path=C:/Windows");
    expect(winDrive.status).toBe(400);

    const uncPath = await request(app).get("/api/system/browse?path=\\\\server\\share");
    expect(uncPath.status).toBe(400);
  });

  it("rejects traversal attempts", async () => {
    const app = createApp();
    const response = await request(app).get("/api/system/browse?path=../../etc");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/traversal/i);
  });

  it("returns 404 when path does not exist", async () => {
    fsMock.pathExists.mockResolvedValue(false);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms");
    expect(response.status).toBe(404);
  });

  it("returns 400 when path is not a directory", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => false });
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms/file.rom");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not a directory/i);
  });

  it("returns sorted directory entries", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([
      { name: "z.bin", isDirectory: () => false },
      { name: "A-folder", isDirectory: () => true },
      { name: "b-folder", isDirectory: () => true },
    ]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms");
    expect(response.status).toBe(200);
    expect(response.body.items.map((i: { name: string }) => i.name)).toEqual([
      "A-folder",
      "b-folder",
      "z.bin",
    ]);
  });

  it("returns root-relative virtual paths for navigation", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([{ name: "roms", isDirectory: () => true }]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=/");
    expect(response.status).toBe(200);
    expect(response.body.path).toBe("/");
    expect(response.body.parent).toBeNull();
    expect(response.body.items[0].path).toBe("/roms");
  });
});
