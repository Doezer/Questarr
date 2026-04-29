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

  it("accepts ?root=/ and browses from file browser root", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([{ name: "data", isDirectory: () => true }]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=/&root=/");
    expect(response.status).toBe(200);
    expect(response.body.items).toBeDefined();
  });

  it("allows browsing child paths under a Windows drive root when using ?root=/", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([{ name: "Vincent", isDirectory: () => true }]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=/Users&root=/");
    expect(response.status).toBe(200);
    expect(response.body.path).toBe("/Users");
    expect(response.body.parent).toBe("/");
  });

  it("rejects traversal in ?root parameter via path segment", async () => {
    // The path param itself contains traversal, which is always rejected
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=../../etc&root=/");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/traversal/i);
  });

  it("rejects absolute Windows path in ?root parameter", async () => {
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=/&root=C:/Windows");
    expect(response.status).toBe(400);
  });

  it("returns 500 when readdir throws EACCES", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    const eaccesError = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    fsMock.readdir.mockRejectedValue(eaccesError);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms");
    expect(response.status).toBe(500);
  });

  it("returns 200 with empty items for an empty directory", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms");
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });

  it("sets parent to the parent virtual path when browsing a subdirectory", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([{ name: "Crash Bandicoot", isDirectory: () => true }]);
    const app = createApp();

    // libraryRoot is /data (set in beforeEach), so /data/roms/psx → parent = /roms
    const response = await request(app).get("/api/system/browse?path=roms/psx");
    expect(response.status).toBe(200);
    expect(response.body.path).toBe("/roms/psx");
    expect(response.body.parent).toBe("/roms");
  });

  it("returns 500 when path contains a null byte", async () => {
    // Node rejects paths with embedded null bytes with ERR_INVALID_ARG_VALUE,
    // which the route catch block translates to 500.
    fsMock.pathExists.mockRejectedValue(
      Object.assign(new Error("Invalid argument"), { code: "ERR_INVALID_ARG_VALUE" })
    );
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms%00evil");
    expect(response.status).toBe(500);
  });

  it("strips leading slashes from path param and browses normally", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([{ name: "psx", isDirectory: () => true }]);
    const app = createApp();

    // //roms should be treated identically to roms
    const response = await request(app).get("/api/system/browse?path=//roms");
    expect(response.status).toBe(200);
    expect(response.body.path).toBe("/roms");
  });

  it("sorts directories before files, then alphabetically within each group", async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    fsMock.readdir.mockResolvedValue([
      { name: "saves", isDirectory: () => false },
      { name: "readme.txt", isDirectory: () => false },
      { name: "psx", isDirectory: () => true },
      { name: "n64", isDirectory: () => true },
    ]);
    const app = createApp();

    const response = await request(app).get("/api/system/browse?path=roms");
    expect(response.status).toBe(200);
    const names = response.body.items.map((i: { name: string }) => i.name);
    // Directories must come before files
    expect(names.indexOf("n64")).toBeLessThan(names.indexOf("saves"));
    expect(names.indexOf("psx")).toBeLessThan(names.indexOf("readme.txt"));
    // Within directories: n64 < psx alphabetically
    expect(names.indexOf("n64")).toBeLessThan(names.indexOf("psx"));
    // Within files: readme.txt < saves alphabetically
    expect(names.indexOf("readme.txt")).toBeLessThan(names.indexOf("saves"));
  });
});
