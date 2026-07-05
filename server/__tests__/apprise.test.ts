import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "child_process";
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

  it("sends notifications via Apprise CLI mode with argument arrays", async () => {
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
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
      "apprise",
      ["-t", "Questarr", "-b", "Test notification", "discord://webhook", "pushover://token@user"],
      expect.objectContaining({
        encoding: "utf8",
        timeout: expect.any(Number),
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }),
      expect.any(Function)
    );
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
});
