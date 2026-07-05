import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "child_process";
import fs from "fs";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { appriseClient } from "../apprise.js";
import { safeFetch } from "../ssrf.js";
import type { Notification } from "../../shared/schema.js";

vi.mock("../logger.js", () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../ssrf.js", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("child_process", () => {
  const execFileMock = vi.fn();
  return {
    execFile: execFileMock,
    default: { execFile: execFileMock },
  };
});

describe("Apprise client", () => {
  const notification = {
    type: "info",
    title: "Questarr",
    message: "Test notification",
  } as Notification;

  let fakeBinaryDir: string;
  let fakeBinaryPath: string;

  beforeAll(() => {
    fakeBinaryDir = mkdtempSync(path.join(tmpdir(), "questarr-apprise-bin-"));
    fakeBinaryPath = path.join(fakeBinaryDir, "apprise");
    fs.writeFileSync(fakeBinaryPath, "#!/bin/sh\n");
    fs.chmodSync(fakeBinaryPath, 0o755);
    process.env.APPRISE_CLI_PATH = fakeBinaryPath;
  });

  afterAll(() => {
    delete process.env.APPRISE_CLI_PATH;
    rmSync(fakeBinaryDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    appriseClient.configure({ mode: "api", apiUrl: null, key: null, urls: null });
  });

  it("sends notifications via Apprise API mode", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as never);

    appriseClient.configure({
      mode: "api",
      apiUrl: "http://apprise:8000",
      key: "config-key",
      urls: null,
    });

    await expect(appriseClient.send(notification)).resolves.toBeUndefined();
    expect(safeFetch).toHaveBeenCalledWith(
      "http://apprise:8000/notify/config-key",
      expect.objectContaining({
        method: "POST",
        allowPrivate: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Questarr", body: "Test notification", type: "info" }),
      })
    );
  });

  it("sends notifications via Apprise CLI mode using a config file, not argv URLs", async () => {
    let capturedArgs: string[] = [];
    let capturedConfigContent = "";
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      capturedArgs = args[1] as string[];
      const configIndex = capturedArgs.indexOf("-c");
      capturedConfigContent = readFileSync(capturedArgs[configIndex + 1], "utf8");
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      callback(null, "ok", "");
      return {} as never;
    });

    appriseClient.configure({
      mode: "cli",
      apiUrl: null,
      key: null,
      urls: "discord://webhook\npushover://token@user",
    });

    await expect(appriseClient.send(notification)).resolves.toBeUndefined();

    expect(execFile).toHaveBeenCalledWith(
      fakeBinaryPath,
      expect.any(Array),
      expect.objectContaining({
        encoding: "utf8",
        timeout: expect.any(Number),
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }),
      expect.any(Function)
    );

    // Title, body, and mapped notification type are passed as CLI flags.
    expect(capturedArgs).toEqual([
      "-t",
      "Questarr",
      "-b",
      "Test notification",
      "-n",
      "info",
      "-c",
      capturedArgs[capturedArgs.length - 1],
    ]);
    // Credentialed URLs are written to a private temp config file, not argv.
    expect(capturedArgs.join(" ")).not.toContain("discord://webhook");
    expect(capturedConfigContent).toBe("discord://webhook\npushover://token@user\n");
  });

  it("passes the mapped notification type for non-info notifications", async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      callback(null, "ok", "");
      return {} as never;
    });

    appriseClient.configure({
      mode: "cli",
      apiUrl: null,
      key: null,
      urls: "discord://webhook",
    });

    await appriseClient.send({ ...notification, type: "error" } as Notification);

    const args = vi.mocked(execFile).mock.calls[0][1] as string[];
    expect(args).toContain("-n");
    expect(args[args.indexOf("-n") + 1]).toBe("failure");
  });

  it("returns a graceful CLI error when the command fails", async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void;
      const error = Object.assign(new Error("spawn apprise ENOENT"), { code: "ENOENT" });
      callback(error, "", "");
      return {} as never;
    });

    appriseClient.configure({
      mode: "cli",
      apiUrl: null,
      key: null,
      urls: "discord://webhook",
    });

    await expect(appriseClient.send(notification)).resolves.toBeUndefined();
    await expect(appriseClient.test()).resolves.toEqual({
      success: false,
      error: "Apprise CLI not found",
    });
  });

  it("reports a clear error when the Apprise CLI binary cannot be found", async () => {
    delete process.env.APPRISE_CLI_PATH;
    vi.resetModules();
    const { appriseClient: freshClient } = await import("../apprise.js");

    freshClient.configure({
      mode: "cli",
      apiUrl: null,
      key: null,
      urls: "discord://webhook",
    });

    await expect(freshClient.test()).resolves.toEqual({
      success: false,
      error: "Apprise CLI not found",
    });
    expect(execFile).not.toHaveBeenCalled();

    process.env.APPRISE_CLI_PATH = fakeBinaryPath;
  });
});
