import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { assertWithinRoots } from "../path-security.js";

describe("assertWithinRoots", () => {
  it("never throws when no roots are configured", async () => {
    await expect(
      assertWithinRoots("/anywhere/at/all", [], "outside roots")
    ).resolves.toBeUndefined();
  });

  it("allows a path nested inside a configured root", async () => {
    await expect(
      assertWithinRoots("/data/downloads/release/game.zip", ["/data/downloads"], "outside roots")
    ).resolves.toBeUndefined();
  });

  it("allows a path exactly equal to a configured root", async () => {
    await expect(
      assertWithinRoots("/data/downloads", ["/data/downloads"], "outside roots")
    ).resolves.toBeUndefined();
  });

  it("allows a path inside any of several configured roots", async () => {
    const roots = ["/data/downloads", "/data/incoming"];
    await expect(
      assertWithinRoots("/data/incoming/release/game.zip", roots, "outside roots")
    ).resolves.toBeUndefined();
  });

  it("rejects a path outside every configured root", async () => {
    await expect(
      assertWithinRoots("/etc/passwd", ["/data/downloads"], "outside roots")
    ).rejects.toThrow("outside roots");
  });

  it("rejects a sibling directory that merely shares a name prefix", async () => {
    // "/data/downloads-other" is not inside "/data/downloads" — a naive
    // startsWith() string check would wrongly allow this.
    await expect(
      assertWithinRoots("/data/downloads-other/game.zip", ["/data/downloads"], "outside roots")
    ).rejects.toThrow("outside roots");
  });

  it("rejects a traversal sequence that resolves outside the configured root", async () => {
    await expect(
      assertWithinRoots(
        path.join("/data/downloads", "..", "..", "etc", "passwd"),
        ["/data/downloads"],
        "outside roots"
      )
    ).rejects.toThrow("outside roots");
  });

  it("allows a filename that merely starts with '..' without being a traversal", async () => {
    // Regression test: a naive relative.startsWith("..") check rejects any file whose
    // own name happens to start with two dots, since path.relative() for a direct
    // child returns just that basename — "..game.exe" both starts with ".." and isn't
    // a traversal sequence, since it doesn't have a path separator after the dots.
    await expect(
      assertWithinRoots("/data/downloads/..game.exe", ["/data/downloads"], "outside roots")
    ).resolves.toBeUndefined();
  });

  it("rejects a path that resolves to exactly the parent of the configured root", async () => {
    await expect(assertWithinRoots("/data", ["/data/downloads"], "outside roots")).rejects.toThrow(
      "outside roots"
    );
  });

  describe("with real paths on disk (realpath resolution)", () => {
    const cleanup: string[] = [];

    function tempDir(): string {
      const dir = path.join(
        os.tmpdir(),
        `questarr-path-security-${Date.now()}-${randomBytes(8).toString("hex")}`
      );
      cleanup.push(dir);
      return dir;
    }

    afterEach(async () => {
      for (const dir of cleanup.splice(0, cleanup.length)) {
        await fs.remove(dir);
      }
    });

    it("rejects a symlink inside a configured root that targets a directory outside it", async () => {
      // Regression test: path.resolve() alone doesn't follow symlinks, so a symlink
      // sitting inside a configured root could point anywhere on disk and slip past a
      // pathname-only containment check while fs.stat/fs.readdir happily follow it.
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      const outsideDir = path.join(root, "outside");
      await fs.ensureDir(downloadsRoot);
      await fs.ensureDir(outsideDir);
      await fs.writeFile(path.join(outsideDir, "secret.txt"), "secret");

      const evilLink = path.join(downloadsRoot, "release");
      await fs.symlink(outsideDir, evilLink);

      await expect(assertWithinRoots(evilLink, [downloadsRoot], "outside roots")).rejects.toThrow(
        "outside roots"
      );
    });

    it("allows a symlink inside a configured root that targets another location inside it", async () => {
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      const realDir = path.join(downloadsRoot, "actual-release");
      await fs.ensureDir(realDir);

      const link = path.join(downloadsRoot, "release");
      await fs.symlink(realDir, link);

      await expect(
        assertWithinRoots(link, [downloadsRoot], "outside roots")
      ).resolves.toBeUndefined();
    });

    it("allows a not-yet-existing path under a configured root that is itself a symlink", async () => {
      // Regression test: when the configured root is itself a symlink, realpath(root)
      // resolves to its real target. If a not-yet-existing candidate under it fell back
      // to the fully lexical path (the symlink, not its target), that lexical path would
      // never match the resolved root computed for the second containment check, and a
      // legitimately pending download would be wrongly rejected.
      const root = tempDir();
      const realRoot = path.join(root, "real-downloads");
      await fs.ensureDir(realRoot);
      const symlinkRoot = path.join(root, "downloads-link");
      await fs.symlink(realRoot, symlinkRoot);

      await expect(
        assertWithinRoots(
          path.join(symlinkRoot, "not-here-yet.zip"),
          [symlinkRoot],
          "outside roots"
        )
      ).resolves.toBeUndefined();
    });

    it("falls back to pathname-only containment for a path that doesn't exist yet", async () => {
      // realpath requires every path segment, including the final one, to exist —
      // a download still being polled for existence has to fall back to a plain
      // resolve() rather than fail outright just because it isn't there yet.
      const root = tempDir();
      const downloadsRoot = path.join(root, "downloads");
      await fs.ensureDir(downloadsRoot);

      await expect(
        assertWithinRoots(
          path.join(downloadsRoot, "not-here-yet.zip"),
          [downloadsRoot],
          "outside roots"
        )
      ).resolves.toBeUndefined();
    });
  });
});
