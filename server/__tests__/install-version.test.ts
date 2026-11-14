import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectVersionFromInstallFolder,
  parseGogInfo,
  parseNfoVersion,
  parseSteamManifest,
  parseVersionTxt,
} from "../install-version.js";

describe("install file parsers", () => {
  it("reads version.txt in its usual shapes", () => {
    expect(parseVersionTxt("1.2.3\n")).toBe("v1.2.3");
    expect(parseVersionTxt("v1.05")).toBe("v1.05");
    expect(parseVersionTxt("Build 12345")).toBe("Build 12345");
    expect(parseVersionTxt("Game Version: 2.0.1")).toBe("v2.0.1");
    expect(parseVersionTxt("\n\n")).toBeNull();
    expect(parseVersionTxt("hello world")).toBeNull();
  });

  it("reads a version line from an .nfo", () => {
    expect(parseNfoVersion("Release : Game\nVersion ......: 1.3.0\nSize: 4GB")).toBe("v1.3.0");
    expect(parseNfoVersion("no version number here")).toBeNull();
  });

  it("reads the GOG build id", () => {
    expect(parseGogInfo(JSON.stringify({ buildId: "58123456789", gameId: "1" }))).toBe(
      "Build 58123456789"
    );
    expect(parseGogInfo("not json")).toBeNull();
    expect(parseGogInfo(JSON.stringify({ gameId: "1" }))).toBeNull();
  });

  it("reads a Steam manifest", () => {
    const acf =
      '"AppState"\n{\n\t"appid"\t\t"620"\n\t"installdir"\t\t"Portal 2"\n\t"buildid"\t\t"9876"\n}';
    expect(parseSteamManifest(acf)).toEqual({ buildId: "9876", installDir: "Portal 2" });
    expect(parseSteamManifest('"AppState" {}')).toBeNull();
  });
});

describe("detectVersionFromInstallFolder", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "detect-version-"));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("prefers version.txt over the other sources", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "3.1");
    await fs.promises.writeFile(path.join(dir, "goggame-1.info"), '{"buildId":"55"}');
    expect(await detectVersionFromInstallFolder(dir)).toBe("v3.1");
  });

  it("falls back to GOG, then an .nfo", async () => {
    await fs.promises.writeFile(path.join(dir, "goggame-1.info"), '{"buildId":"55"}');
    await fs.promises.writeFile(path.join(dir, "release.nfo"), "Version: 9.9");
    expect(await detectVersionFromInstallFolder(dir)).toBe("Build 55");
    await fs.promises.rm(path.join(dir, "goggame-1.info"));
    expect(await detectVersionFromInstallFolder(dir)).toBe("v9.9");
  });

  it("finds the Steam build next to steamapps/common/<game>", async () => {
    const game = path.join(dir, "steamapps", "common", "Portal 2");
    await fs.promises.mkdir(game, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, "steamapps", "appmanifest_620.acf"),
      '"AppState"\n{\n\t"installdir"\t\t"Portal 2"\n\t"buildid"\t\t"9876"\n}'
    );
    expect(await detectVersionFromInstallFolder(game)).toBe("Build 9876");
  });

  it("ignores oversized files, files instead of folders and missing paths", async () => {
    await fs.promises.writeFile(path.join(dir, "version.txt"), "1.0\n" + "x".repeat(70 * 1024));
    expect(await detectVersionFromInstallFolder(dir)).toBeNull();
    expect(await detectVersionFromInstallFolder(path.join(dir, "version.txt"))).toBeNull();
    expect(await detectVersionFromInstallFolder(path.join(dir, "missing"))).toBeNull();
  });
});
